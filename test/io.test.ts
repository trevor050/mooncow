import { aggregateSites, duplicateTabIds, normalizeForDuplicates } from '@/lib/browser-ops';
import { renderMarkdown } from '@/lib/markdown';
import { buildRequestBody, chatCompletionsUrl, parseChatStream, sseData, streamChat } from '@/lib/openai';
import { DEFAULT_SETTINGS, mergeSettings, originPattern } from '@/lib/settings';

const enc = new TextEncoder();
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}
async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of it) out.push(x);
  return out;
}

describe('SSE parsing', () => {
  it('handles lines split across chunks, CRLF and comments', async () => {
    const data = await collect(sseData(streamOf([': keep-alive\r\n\r\ndata: {"a"', ':1}\r\n\r\nda', 'ta: two\ndata: lines\n\n'])));
    expect(data).toEqual(['{"a":1}', 'two\nlines']);
  });

  it('turns chat chunks into events and stops at [DONE]', async () => {
    const body = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"ignored"}}]}\n\n',
    ];
    const events = await collect(parseChatStream(streamOf(body)));
    expect(events).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'delta', text: 'Hel' },
      { type: 'delta', text: 'lo' },
      { type: 'done', finishReason: 'stop' },
      { type: 'done' },
    ]);
  });

  it('surfaces in-stream errors', async () => {
    await expect(collect(parseChatStream(streamOf(['data: {"error":{"message":"overloaded"}}\n\n'])))).rejects.toThrow('overloaded');
  });
});

describe('OpenAI-compatible client', () => {
  it('builds the URL and a minimal body', () => {
    expect(chatCompletionsUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1/chat/completions');
    expect(chatCompletionsUrl('http://localhost:11434/v1/chat/completions')).toBe('http://localhost:11434/v1/chat/completions');
    const body = buildRequestBody(DEFAULT_SETTINGS.ai, [{ role: 'user', content: 'hi' }]);
    expect(body).toEqual({ model: 'gpt-6-luna', messages: [{ role: 'user', content: 'hi' }], stream: true });
    expect(buildRequestBody({ ...DEFAULT_SETTINGS.ai, reasoningEffort: 'low' }, []).reasoning_effort).toBe('low');
  });

  it('sends the key only as a bearer header, and explains failures', async () => {
    let seen: RequestInit | undefined;
    const ok: typeof fetch = async (_url, init) => {
      seen = init;
      return new Response(streamOf(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n']), { status: 200 });
    };
    const events = await collect(streamChat({ ...DEFAULT_SETTINGS.ai, apiKey: 'sk-test' }, [], undefined, ok));
    expect(events[0]).toEqual({ type: 'delta', text: 'ok' });
    expect((seen!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(String(seen!.body)).not.toContain('sk-test');

    const noKey: typeof fetch = async (_u, init) => {
      expect((init!.headers as Record<string, string>).Authorization).toBeUndefined();
      return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    };
    await expect(collect(streamChat({ ...DEFAULT_SETTINGS.ai, apiKey: '' }, [], undefined, noKey))).rejects.toThrow(/API key was rejected/);
  });
});

describe('settings', () => {
  it('fills defaults and keeps suggestions off', () => {
    const s = mergeSettings({ ai: { model: 'llama3.2' } as never });
    expect(s.ai.baseUrl).toBe('https://api.openai.com/v1');
    expect(s.ai.model).toBe('llama3.2');
    expect(s.suggestions).toBe(false);
  });
  it('requests exactly one origin', () => {
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(originPattern('ftp://x')).toBeNull();
  });
});

describe('markdown renderer', () => {
  const html = (md: string) => {
    const div = document.createElement('div');
    div.append(renderMarkdown(document, md));
    return div.innerHTML;
  };
  it('renders the common subset', () => {
    expect(html('# Title\n\nSome **bold** and *em* and `code`.')).toBe('<h3>Title</h3><p>Some <strong>bold</strong> and <em>em</em> and <code>code</code>.</p>');
    expect(html('- a\n- b\n\n1. one')).toBe('<ul><li>a</li><li>b</li></ul><ol><li>one</li></ol>');
    expect(html('```js\nconst x = 1 < 2;\n```')).toBe('<pre><code data-lang="js">const x = 1 &lt; 2;</code></pre>');
  });
  it('never creates markup from model output', () => {
    const out = html('<img src=x onerror=alert(1)> <script>alert(1)</script> [x](javascript:alert(1)) [ok](https://example.com)');
    expect(out).not.toMatch(/<img|<script|javascript:/);
    expect(out).toContain('&lt;img');
    expect(out).toContain('<a href="https://example.com/" target="_blank" rel="noopener noreferrer">ok</a>');
  });
});

describe('tab housekeeping', () => {
  const t = (id: number, url: string, over = {}) => ({ id, url, active: false, pinned: false, lastAccessed: id, ...over });
  it('finds duplicates, keeping the active, pinned or most recent copy', () => {
    expect(normalizeForDuplicates('https://a.com/x/#frag')).toBe('https://a.com/x');
    expect(duplicateTabIds([t(1, 'https://a.com/'), t(2, 'https://a.com'), t(3, 'https://a.com/#top', { active: true })])).toEqual([1, 2]);
    expect(duplicateTabIds([t(1, 'https://b.com', { pinned: true }), t(2, 'https://b.com')])).toEqual([2]);
    expect(duplicateTabIds([t(1, 'https://c.com'), t(5, 'https://c.com')])).toEqual([1]);
    expect(duplicateTabIds([t(1, 'about:blank'), t(2, 'about:blank')])).toEqual([]);
  });
  it('aggregates history into a site index', () => {
    const day = 86_400_000;
    const sites = aggregateSites(
      [
        { url: 'https://www.github.com/a', visitCount: 3, typedCount: 1, lastVisitTime: 10 * day },
        { url: 'https://github.com/b', visitCount: 2, typedCount: 0, lastVisitTime: 12 * day + 5 },
        { url: 'https://news.ycombinator.com/', visitCount: 1, typedCount: 0, lastVisitTime: 12 * day },
      ],
      ['https://github.com/c'],
    );
    expect(sites.find((s) => s.domain === 'github.com')).toEqual({ domain: 'github.com', visitCount: 5, typedCount: 1, lastVisitTime: 12 * day + 5, daysActive: 2, openCount: 1 });
  });
});
