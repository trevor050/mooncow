import type { View, ViewContext } from '@/core/types';
import { AI_PORT, CHAT_KEY, type AiEvent, type AiRequest, type SavedChat } from '@/lib/messages';
import { renderMarkdown } from '@/lib/markdown';
import type { ChatMessage } from '@/lib/openai';
import { loadSettings, originPattern, saveSettings } from '@/lib/settings';
import { clear, h, isMod } from '../dom';
import { glyph } from '../icons';

export const AI_PRESETS: { label: string; baseUrl: string; model: string; needsKey: boolean }[] = [
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', needsKey: true },
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-6-luna', needsKey: true },
  { label: 'Ollama', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false },
  { label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'local-model', needsKey: false },
];

/** Ask for host access to exactly the configured AI origin. Call from a click handler. */
export async function requestAiOrigin(baseUrl: string): Promise<boolean> {
  const pattern = originPattern(baseUrl);
  if (!pattern || !browser.permissions?.request) return false;
  try {
    return await browser.permissions.request({ origins: [pattern] });
  } catch {
    return false;
  }
}

interface ChatOptions {
  prompt?: string;
  includePage?: boolean;
  resume?: boolean;
}

export function chatView(options: ChatOptions = {}): View {
  return {
    id: 'chat',
    title: 'AI chat',
    mount(root, ctx) {
      let messages: ChatMessage[] = [];
      let includePage = !!options.includePage;
      let port: ReturnType<typeof browser.runtime.connect> | null = null;
      let streaming = false;
      let current: ChatMessage | null = null;

      const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
      const input = h('textarea', { class: 'chat-input', rows: '1', placeholder: 'Ask anything…', 'aria-label': 'Message', autofocus: true });
      const pageChip = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(includePage), title: 'Send the visible text of this page with your question' }, glyph('tab', 14), 'This page');
      const send = h('button', { class: 'send', type: 'button', title: 'Send (Enter)' }, glyph('sparkle', 16));
      const newChat = h('button', { class: 'ghost', type: 'button', title: 'Start over' }, 'New chat');
      const modelLabel = h('span', { class: 'chat-model' });
      const header = h('div', { class: 'chat-head' }, h('span', { class: 'chat-title' }, 'AI chat'), modelLabel, newChat);
      const composer = h('div', { class: 'composer' }, pageChip, input, send);
      root.append(h('div', { class: 'chat' }, header, log, composer));

      const scrollDown = () => { log.scrollTop = log.scrollHeight; };
      const autosize = () => { input.style.height = 'auto'; input.style.height = `${Math.min(140, input.scrollHeight)}px`; };

      function renderMessage(msg: ChatMessage): HTMLElement {
        if (msg.role === 'user') return h('div', { class: 'msg user' }, msg.content);
        const body = h('div', { class: 'msg-body' });
        body.append(renderMarkdown(document, msg.content));
        const copy = h('button', { class: 'ghost small', type: 'button' }, glyph('copy', 13), 'Copy');
        copy.addEventListener('click', async () => { await ctx.copy(msg.content); ctx.toast('Copied'); });
        return h('div', { class: 'msg assistant' }, body, h('div', { class: 'msg-actions' }, copy));
      }

      function renderAll() {
        clear(log);
        if (!messages.length) {
          log.append(h('div', { class: 'chat-empty' }, includePage ? 'Ask about this page. Its visible text goes to your AI provider with the question.' : 'Ask anything. Answers stream from the model you configured.'));
        }
        for (const m of messages) if (m.role !== 'system') log.append(renderMessage(m));
        scrollDown();
      }

      function setStreaming(on: boolean) {
        streaming = on;
        send.classList.toggle('stop', on);
        send.title = on ? 'Stop' : 'Send (Enter)';
        clear(send);
        send.append(on ? h('span', { class: 'stop-square' }) : glyph('sparkle', 16));
      }

      async function persist() {
        const firstUser = messages.find((m) => m.role === 'user');
        if (!firstUser) return;
        const saved: SavedChat = { title: firstUser.content.slice(0, 80), messages, updatedAt: Date.now() };
        await browser.storage.local.set({ [CHAT_KEY]: saved });
      }

      function showError(message: string) {
        const settingsBtn = h('button', { class: 'ghost small', type: 'button' }, 'Open settings');
        settingsBtn.addEventListener('click', () => void ctx.browser.openOptions());
        log.append(h('div', { class: 'msg error' }, message, ' ', settingsBtn));
        scrollDown();
      }

      async function ask(text: string) {
        const content = text.trim();
        if (!content || streaming) return;
        messages.push({ role: 'user', content });
        input.value = '';
        autosize();
        renderAll();
        const answer: ChatMessage = { role: 'assistant', content: '' };
        current = answer;
        const bubble = h('div', { class: 'msg assistant streaming' }, h('div', { class: 'msg-body' }, h('span', { class: 'typing' }, 'Thinking…')));
        log.append(bubble);
        scrollDown();
        setStreaming(true);

        let outgoing = messages.slice();
        if (includePage) {
          const [info, text] = await Promise.all([ctx.browser.pageInfo(), ctx.browser.pageText()]);
          if (text) {
            outgoing = [
              { role: 'system', content: `The user is looking at this page. Use it when relevant.\nTitle: ${info?.title || ''}\nURL: ${info?.url || ''}\n---\n${text}` },
              ...outgoing,
            ];
          }
        }

        let frame = 0;
        const paint = () => {
          frame = 0;
          const body = bubble.querySelector('.msg-body')!;
          clear(body);
          body.append(renderMarkdown(document, answer.content || '…'));
          scrollDown();
        };
        port = browser.runtime.connect({ name: AI_PORT });
        const finish = async (error?: string) => {
          if (!streaming) return;
          setStreaming(false);
          try { port?.disconnect(); } catch {}
          port = null;
          bubble.remove();
          if (answer.content) messages.push(answer);
          renderAll();
          if (error) showError(error);
          await persist();
          input.focus();
        };
        port.onMessage.addListener((event: AiEvent) => {
          if (event.type === 'delta') {
            answer.content += event.text;
            if (!frame) frame = requestAnimationFrame(paint);
          } else if (event.type === 'done') void finish();
          else if (event.type === 'error') void finish(event.message);
        });
        port.onDisconnect.addListener(() => void finish(streaming ? 'The connection to the background closed.' : undefined));
        const request: AiRequest = { type: 'ask', messages: outgoing, includePage, tabId: null };
        port.postMessage(request);
      }

      function stop() {
        if (!streaming) return;
        try { port?.disconnect(); } catch {}
        // Keep what arrived so far.
        setStreaming(false);
        log.querySelector('.msg.assistant.streaming')?.remove();
        if (current?.content) messages.push({ ...current });
        current = null;
        renderAll();
        void persist();
      }

      send.addEventListener('click', () => (streaming ? stop() : void ask(input.value)));
      newChat.addEventListener('click', async () => {
        stop();
        messages = [];
        await browser.storage.local.remove(CHAT_KEY);
        renderAll();
        input.focus();
      });
      pageChip.addEventListener('click', () => {
        includePage = !includePage;
        pageChip.setAttribute('aria-pressed', String(includePage));
        if (!messages.length) renderAll();
      });
      input.addEventListener('input', autosize);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          void ask(input.value);
        } else if (isMod(e) && e.key === '.') {
          e.preventDefault();
          stop();
        }
      });

      // ---------------------------------------------------- first-run setup
      function renderSetup(ctxView: ViewContext, onReady: () => void) {
        const s = ctxView.settings.ai;
        if (!browser.permissions?.request) {
          // Inside a web page Firefox cannot show a permission prompt from this frame.
          const open = h('button', { class: 'primary', type: 'button', autofocus: true }, 'Open settings');
          open.addEventListener('click', () => void ctxView.browser.openOptions());
          clear(log);
          log.append(h('div', { class: 'setup' },
            h('h2', {}, 'Connect a model'),
            h('p', { class: 'muted' }, 'Add an OpenAI-compatible endpoint and key in settings: OpenAI, OpenRouter, or a local server like Ollama. Then come back here.'),
            h('div', { class: 'setup-row' }, open)));
          composer.hidden = true;
          open.focus();
          return;
        }
        const base = h('input', { class: 'field', type: 'url', value: s.baseUrl, 'aria-label': 'Base URL', spellcheck: 'false' });
        const key = h('input', { class: 'field', type: 'password', value: s.apiKey, placeholder: 'sk-…', 'aria-label': 'API key', autocomplete: 'off' });
        const model = h('input', { class: 'field', type: 'text', value: s.model, 'aria-label': 'Model', spellcheck: 'false' });
        const presets = h('div', { class: 'presets' });
        for (const p of AI_PRESETS) {
          const b = h('button', { class: 'chip', type: 'button' }, p.label);
          b.addEventListener('click', () => { base.value = p.baseUrl; model.value = p.model; (p.needsKey ? key : model).focus(); });
          presets.append(b);
        }
        const save = h('button', { class: 'primary', type: 'button' }, 'Connect');
        const note = h('p', { class: 'fine' }, 'Your key is stored only in this browser profile. Questions (and page text, when you include it) are sent to this endpoint and nowhere else.');
        const card = h('div', { class: 'setup' },
          h('h2', {}, 'Connect a model'),
          h('p', { class: 'muted' }, 'Any OpenAI-compatible endpoint works: OpenAI, OpenRouter, or a local server like Ollama.'),
          presets,
          h('label', {}, 'Base URL', base),
          h('label', {}, 'API key', key),
          h('label', {}, 'Model', model),
          h('div', { class: 'setup-row' }, save),
          note,
        );
        save.addEventListener('click', () => {
          // permissions.request must be the first await inside the click.
          const granted = requestAiOrigin(base.value);
          void granted.then(async (ok) => {
            if (!ok) { ctxView.toast('MoonCow needs permission to reach that address'); return; }
            const current = await loadSettings();
            await saveSettings({ ...current, ai: { ...current.ai, baseUrl: base.value.trim(), apiKey: key.value.trim(), model: model.value.trim() } });
            card.remove();
            onReady();
          });
        });
        clear(log);
        log.append(card);
        composer.hidden = true;
        (s.baseUrl ? key : base).focus();
      }

      const start = async () => {
        const settings = await loadSettings();
        modelLabel.textContent = settings.ai.model;
        // Hosted APIs need a key; local servers usually do not. Host permission
        // is requested when settings are saved; endpoints that allow CORS work without it.
        const ready = !!settings.ai.baseUrl && !!settings.ai.model &&
          (!!settings.ai.apiKey || !/api\.openai\.com|openrouter\.ai/.test(settings.ai.baseUrl));
        if (!ready) {
          renderSetup(ctx, () => { composer.hidden = false; void start(); });
          return;
        }
        composer.hidden = false;
        if (options.resume) {
          const saved = (await browser.storage.local.get(CHAT_KEY))[CHAT_KEY] as SavedChat | undefined;
          messages = saved?.messages || [];
        }
        renderAll();
        input.focus();
        if (options.prompt && !messages.length) void ask(options.prompt);
        options.prompt = undefined;
      };
      void start();

      return () => {
        try { port?.disconnect(); } catch {}
      };
    },
  };
}
