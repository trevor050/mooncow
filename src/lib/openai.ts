// Minimal OpenAI-compatible Chat Completions client with streaming.
//
// Works with api.openai.com and anything that speaks the same protocol
// (OpenRouter, Groq, Ollama, LM Studio, llama.cpp server, vLLM). The request
// body is kept to fields every implementation accepts; `reasoning_effort` is
// only sent when the user sets it.

import type { AiSettings } from '@/core/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'done'; finishReason?: string };

export class AiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'AiError';
  }
}

export function chatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

export function buildRequestBody(settings: AiSettings, messages: ChatMessage[]): Record<string, unknown> {
  const body: Record<string, unknown> = { model: settings.model, messages, stream: true };
  if (settings.reasoningEffort) body.reasoning_effort = settings.reasoningEffort;
  return body;
}

/**
 * Turn a stream of Server-Sent Events bytes into data payloads. Handles
 * chunks that split lines, CRLF endings, comments and multi-line data fields.
 */
export async function* sseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
  let buffer = '';
  let data: string[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          if (data.length) yield data.join('\n');
          data = [];
        } else if (line.startsWith('data:')) {
          data.push(line.slice(5).replace(/^ /, ''));
        }
        // Other fields (event:, id:, retry:) and ":" comments are ignored.
      }
    }
    if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
    if (data.length) yield data.join('\n');
  } finally {
    reader.releaseLock();
  }
}

interface ChunkChoice {
  delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
  finish_reason?: string | null;
}

export async function* parseChatStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  for await (const payload of sseData(stream)) {
    if (payload.trim() === '[DONE]') {
      yield { type: 'done' };
      return;
    }
    let chunk: { choices?: ChunkChoice[]; error?: { message?: string } };
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    if (chunk.error) throw new AiError(chunk.error.message || 'The model returned an error');
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const reasoning = choice.delta?.reasoning_content ?? choice.delta?.reasoning;
    if (reasoning) yield { type: 'reasoning', text: reasoning };
    if (choice.delta?.content) yield { type: 'delta', text: choice.delta.content };
    if (choice.finish_reason) yield { type: 'done', finishReason: choice.finish_reason };
  }
  yield { type: 'done' };
}

async function errorMessage(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.message || '';
  } catch {}
  if (res.status === 401) return 'The API key was rejected. Check it in MoonCow settings.';
  if (res.status === 404) return `Not found: check the base URL and model name.${detail ? ` (${detail})` : ''}`;
  if (res.status === 429) return `Rate limited or out of credit.${detail ? ` ${detail}` : ''}`;
  return detail || `Request failed with HTTP ${res.status}`;
}

export async function* streamChat(
  settings: AiSettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<StreamEvent> {
  if (!settings.baseUrl) throw new AiError('Set a base URL in MoonCow settings.');
  if (!settings.model) throw new AiError('Set a model name in MoonCow settings.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  // Local servers usually need no key, so an empty key is allowed.
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  let res: Response;
  try {
    res = await fetchImpl(chatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequestBody(settings, messages)),
      signal,
      credentials: 'omit',
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new AiError(`Could not reach ${settings.baseUrl}. Is the server running and allowed in settings?`);
  }
  if (!res.ok) throw new AiError(await errorMessage(res), res.status);
  if (!res.body) throw new AiError('The server returned an empty response.');
  yield* parseChatStream(res.body);
}
