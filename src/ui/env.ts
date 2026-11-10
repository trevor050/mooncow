// Wires the palette to the browser: where results come from (DataSource) and
// what actions can do (BrowserBridge). Every call is relayed to the
// background (see lib/browser-ops.ts for why).
import type { BrowserBridge, ClosedTabInfo, DataSource, HistoryInfo, Settings, SiteInfo, TabInfo, ThemeSetting } from '@/core/types';
import type { Host, OpName, OpRequest, OpResponse, ops } from '@/lib/browser-ops';
import { CHAT_KEY } from '@/lib/messages';
import { loadSettings, saveSettings } from '@/lib/settings';
import { setSiteIconResolver } from './icons';

export type HostTab = Host;

const isFirefox = () => /Firefox\//.test(navigator.userAgent);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

type Rest<F> = F extends (host: Host, ...args: infer A) => unknown ? A : never;
type Ret<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;

export function createEnvironment(host: Host, getSettings: () => Settings, options: { explicitHost: boolean }) {
  async function call<K extends OpName>(op: K, ...args: Rest<(typeof ops)[K]>): Promise<Ret<(typeof ops)[K]>> {
    const request: OpRequest<K> = { type: 'op', op, args, ...(options.explicitHost ? { host } : {}) };
    const res = (await browser.runtime.sendMessage(request)) as OpResponse | undefined;
    if (!res) throw new Error('MoonCow’s background is not responding');
    if (!res.ok) throw new Error(res.error);
    return res.value as Ret<(typeof ops)[K]>;
  }

  const tabIcons = new Map<string, string>();
  let tabsCache: { at: number; tabs: TabInfo[] } | null = null;
  const suggestionCache = new Map<string, string[]>();

  // Favicons: Chromium has a local favicon store; Firefox has no API, so reuse
  // icons from open tabs and fall back to a glyph. Nothing goes to a third party.
  setSiteIconResolver((url) => {
    if (!isFirefox()) {
      const u = new URL(browser.runtime.getURL('/_favicon/' as '/'));
      u.searchParams.set('pageUrl', url);
      u.searchParams.set('size', '32');
      return u.href;
    }
    return tabIcons.get(hostOf(url)) || null;
  });

  async function tabs(): Promise<TabInfo[]> {
    if (tabsCache && Date.now() - tabsCache.at < 1000) return tabsCache.tabs;
    const list = await call('tabs');
    for (const t of list) if (t.favIconUrl && /^(https?|data):/.test(t.favIconUrl)) tabIcons.set(hostOf(t.url), t.favIconUrl);
    tabsCache = { at: Date.now(), tabs: list };
    return list;
  }

  const data: DataSource = {
    tabs,
    history: (text): Promise<HistoryInfo[]> => call('history', text),
    bookmarks: (text) => call('bookmarks', text),
    recentlyClosed: (): Promise<ClosedTabInfo[]> => call('recentlyClosed'),
    sites: (): Promise<SiteInfo[]> => call('sites'),
    async suggestions(text) {
      if (!getSettings().suggestions) return [];
      const key = text.toLowerCase();
      if (!suggestionCache.has(key)) suggestionCache.set(key, await call('suggestions', text));
      return suggestionCache.get(key)!;
    },
    async lastChat() {
      const saved = (await browser.storage.local.get(CHAT_KEY))[CHAT_KEY] as { title?: string } | undefined;
      return saved?.title || null;
    },
  };

  const bridge: BrowserBridge = {
    switchToTab: (tabId, windowId) => call('switchToTab', tabId, windowId),
    async tabAction(action, tabId) {
      tabsCache = null;
      const result = await call('tabAction', action, tabId);
      if (action === 'screenshot' && typeof result === 'string') {
        const a = document.createElement('a');
        a.href = result;
        a.download = `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    },
    restoreClosed: (sessionId) => call('restoreClosed', sessionId),
    deleteHistory: (url) => call('deleteHistory', url),
    pageInfo: () => call('pageInfo'),
    pageText: () => call('pageText'),
    openOptions: () => call('openOptions'),
    async setTheme(theme: ThemeSetting) {
      const current = await loadSettings();
      await saveSettings({ ...current, theme });
    },
  };

  return {
    data,
    bridge,
    open: (url: string, newTab: boolean) => call('open', url, newTab),
    invalidate: () => { tabsCache = null; },
  };
}
