import { Query } from '@/core/query';
import { ToolRegistry } from '@/core/registry';
import type { ActionContext, Result } from '@/core/types';
import { handleOp, watchSiteChanges, type OpRequest } from '@/lib/browser-ops';
import { AI_PORT, type AiEvent, type AiRequest, type BackgroundRequest } from '@/lib/messages';
import { AiError, streamChat, type ChatMessage } from '@/lib/openai';
import { loadSettings } from '@/lib/settings';
import appSearch from '@/tools/app-search';
import calculator from '@/tools/calculator';
import converter from '@/tools/converter';
import datetime from '@/tools/datetime';
import encoders from '@/tools/encoders';
import time from '@/tools/time';
import { toUrl } from '@/tools/web';

const SYSTEM_PROMPT = (now: Date) =>
  `You are MoonCow, an assistant that lives in the user's browser command bar. ` +
  `Answer directly and concisely, use Markdown when it helps, and say so when you are unsure. ` +
  `Today is ${now.toDateString()}.`;

export default defineBackground(() => {
  watchSiteChanges();
  // ------------------------------------------------------------ open the bar
  async function openWindowFallback(tab: { id?: number; windowId?: number }) {
    const url = browser.runtime.getURL(`/palette.html?surface=window&tab=${tab.id ?? ''}&window=${tab.windowId ?? ''}` as '/palette.html');
    const width = 760;
    const height = 560;
    let left: number | undefined;
    let top: number | undefined;
    try {
      const win = typeof tab.windowId === 'number' ? await browser.windows.get(tab.windowId) : null;
      if (win && win.width && win.left !== undefined && win.top !== undefined) {
        left = Math.round(win.left + (win.width - width) / 2);
        top = Math.round(win.top + 80);
      }
    } catch {}
    await browser.windows.create({ url, type: 'popup', width, height, left, top });
  }

  async function togglePalette(tab?: { id?: number; windowId?: number; url?: string }) {
    const active = tab?.id ? tab : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!active?.id) return;
    // The new tab page already is the bar; focus it instead of layering another one.
    if (active.url?.startsWith(browser.runtime.getURL('/newtab.html' as '/'))) {
      void browser.runtime.sendMessage({ type: 'mooncow:focus-newtab' }).catch(() => {});
      return;
    }
    try {
      await browser.tabs.sendMessage(active.id, { type: 'mooncow:toggle' });
      return;
    } catch {}
    // Tabs opened before MoonCow was installed have no content script yet.
    try {
      await browser.scripting.executeScript({ target: { tabId: active.id }, files: ['/content-scripts/content.js'] });
      await browser.tabs.sendMessage(active.id, { type: 'mooncow:toggle' });
      return;
    } catch {}
    // Browser pages (settings, the extension store, the built-in new tab) cannot host the overlay.
    await openWindowFallback(active);
  }

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-palette') void togglePalette(tab);
  });
  browser.action.onClicked.addListener((tab) => void togglePalette(tab));

  browser.runtime.onMessage.addListener((message: BackgroundRequest | OpRequest, sender, sendResponse) => {
    let response: Promise<unknown> | undefined;
    if (message?.type === 'op') response = handleOp(message, sender);
    else if (message?.type === 'whoami') response = Promise.resolve({ tabId: sender.tab?.id ?? null, windowId: sender.tab?.windowId ?? null });
    else if (message?.type === 'open-options') response = browser.runtime.openOptionsPage();
    else if (message?.type === 'has-origin') response = browser.permissions.contains({ origins: [message.pattern] });
    if (!response) return undefined;
    // Promise return values are ignored by Chrome before 148. The callback
    // channel works in those versions and in Firefox/Zen.
    void response.then(sendResponse, (err) => {
      console.warn('[mooncow] background request failed', err);
      sendResponse(undefined);
    });
    return true;
  });

  // ---------------------------------------------------------------- AI chat
  // The panel opens one port per question. The key never leaves storage except
  // in the Authorization header to the endpoint the user configured.
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_PORT) return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    const send = (event: AiEvent) => {
      if (controller.signal.aborted) return;
      try { port.postMessage(event); } catch {}
    };
    port.onMessage.addListener(async (request: AiRequest) => {
      if (request?.type !== 'ask') return;
      try {
        const settings = await loadSettings();
        const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT(new Date()) }, ...request.messages];
        for await (const event of streamChat(settings.ai, messages, controller.signal)) {
          if (event.type === 'delta') send({ type: 'delta', text: event.text });
          else if (event.type === 'reasoning') send({ type: 'reasoning', text: event.text });
          else if (event.type === 'done') break;
        }
        send({ type: 'done' });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        send({ type: 'error', message: err instanceof AiError ? err.message : `Something went wrong: ${(err as Error).message}` });
      }
    });
  });

  // ------------------------------------------------------------ "mc" keyword
  // The address bar keyword runs the same plugins, limited to ones that answer
  // instantly without page or history access.
  const omniboxTools = new ToolRegistry().register(calculator, converter, datetime, time, encoders, appSearch);
  const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const isFirefox = /Firefox\//.test(navigator.userAgent);
  const describe = (r: Result) => {
    const text = r.answer !== undefined ? `${r.title} ${r.answer}` : `${r.title}${r.subtitle ? ` — ${r.subtitle}` : ''}`;
    return isFirefox ? text : escapeXml(text);
  };
  const noData = {
    tabs: async () => [],
    history: async () => [],
    bookmarks: async () => [],
    suggestions: async () => [],
    recentlyClosed: async () => [],
    sites: async () => [],
    lastChat: async () => null,
  };

  async function omniboxResults(text: string): Promise<Result[]> {
    const settings = await loadSettings();
    return omniboxTools.run(new Query(text), { signal: new AbortController().signal, now: Date.now(), settings, data: noData });
  }

  browser.omnibox.setDefaultSuggestion({ description: 'MoonCow: search, calculate, convert, or @site search' });
  browser.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const results = (await omniboxResults(text)).filter((r) => r.kind === 'answer' || r.kind === 'command');
    suggest(results.slice(0, 5).map((r) => ({ content: r.answer ?? `${r.title} `, description: describe(r) })));
  });

  browser.omnibox.onInputEntered.addListener(async (text, disposition) => {
    const openUrl = async (url: string) => {
      if (disposition === 'currentTab') {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (tab?.id) await browser.tabs.update(tab.id, { url });
      } else {
        await browser.tabs.create({ url, active: disposition === 'newForegroundTab' });
      }
    };
    const direct = toUrl(text);
    if (direct) return openUrl(direct);
    const [top] = await omniboxResults(text);
    if (top && top.kind === 'command' && top.actions[0]) {
      // Site searches open a URL; run the action with a context that can only open URLs.
      let opened = false;
      const ctx = {
        open: async (url: string) => { opened = true; await openUrl(url); },
      } as unknown as ActionContext;
      try { await top.actions[0].run(ctx); } catch {}
      if (opened) return;
    }
    await openUrl(`https://www.google.com/search?q=${encodeURIComponent(text)}`);
  });
});
