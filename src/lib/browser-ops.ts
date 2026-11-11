// Browser operations, executed in the background.
//
// Firefox gives an extension iframe embedded in a web page only the content
// script API surface (no tabs, history, sessions or permissions), so the
// palette asks the background to do this work over runtime messaging. Every
// surface uses the same path, which keeps behaviour identical across browsers.
import type { ClosedTabInfo, HistoryInfo, SiteInfo, TabAction, TabInfo } from '@/core/types';
import type { PageText } from './messages';

const DAY = 86_400_000;

export interface Host {
  tabId: number | null;
  windowId: number | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Only browser-canonical exact URLs are duplicates; fragments and path slashes can carry state. */
export function normalizeForDuplicates(url: string): string {
  try { return new URL(url).href; } catch { return url; }
}

/** Which tabs "Close duplicate tabs" removes: keep the active one, else a pinned one, else the most recently used. */
export function duplicateTabIds(tabs: Pick<TabInfo, 'id' | 'url' | 'active' | 'lastAccessed' | 'pinned'>[]): number[] {
  const groups = new Map<string, typeof tabs>();
  for (const t of tabs) {
    if (!/^https?:/.test(t.url)) continue;
    const key = normalizeForDuplicates(t.url);
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const remove: number[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keep = group.find((t) => t.active) || group.find((t) => t.pinned) || [...group].sort((a, b) => b.lastAccessed - a.lastAccessed)[0];
    for (const t of group) if (t !== keep && !t.pinned && !t.active) remove.push(t.id);
  }
  return remove;
}

export function aggregateSites(items: { url?: string; visitCount?: number; typedCount?: number; lastVisitTime?: number }[], openUrls: string[]): SiteInfo[] {
  const map = new Map<string, SiteInfo & { days: Set<number> }>();
  for (const item of items) {
    const domain = item.url ? hostOf(item.url) : '';
    if (!domain) continue;
    const s = map.get(domain) || { domain, visitCount: 0, typedCount: 0, lastVisitTime: 0, daysActive: 0, openCount: 0, days: new Set<number>() };
    s.visitCount += item.visitCount || 0;
    s.typedCount += item.typedCount || 0;
    s.lastVisitTime = Math.max(s.lastVisitTime, item.lastVisitTime || 0);
    if (item.lastVisitTime) s.days.add(Math.floor(item.lastVisitTime / DAY));
    map.set(domain, s);
  }
  for (const url of openUrls) {
    const s = map.get(hostOf(url));
    if (s) s.openCount++;
  }
  return [...map.values()].map(({ days, ...s }) => ({ ...s, daysActive: days.size }));
}

const extensionOrigin = () => browser.runtime.getURL('/');

async function tabs(host: Host): Promise<TabInfo[]> {
  const all = await browser.tabs.query({});
  return all
    .filter((t) => typeof t.id === 'number' && !(t.url || '').startsWith(extensionOrigin()))
    .map((t) => ({
      id: t.id!,
      windowId: t.windowId!,
      title: t.title || '',
      url: t.url || (t as { pendingUrl?: string }).pendingUrl || '',
      favIconUrl: t.favIconUrl,
      pinned: !!t.pinned,
      active: t.id === host.tabId,
      audible: !!t.audible,
      muted: !!t.mutedInfo?.muted,
      lastAccessed: (t as { lastAccessed?: number }).lastAccessed || 0,
    }));
}

function target(host: Host, tabId?: number): number {
  const id = tabId ?? host.tabId;
  if (typeof id !== 'number') throw new Error('There is no tab to act on here');
  return id;
}

interface ClosingTab {
  id?: number; windowId: number; index: number; url?: string; pendingUrl?: string;
  pinned: boolean; active: boolean; hidden?: boolean; lastAccessed?: number;
}
interface ClosingSnapshot { tabs: ClosingTab[]; windows: number[] }

async function closingSnapshot(host: Host): Promise<ClosingSnapshot> {
  const runtime = browser.runtime as typeof browser.runtime & { getBrowserInfo?: () => Promise<{ name: string; zen?: unknown }> };
  const [all, windows, info] = await Promise.all([
    browser.tabs.query({}),
    browser.windows.getAll({ windowTypes: ['normal'] }),
    typeof runtime.getBrowserInfo === 'function' ? runtime.getBrowserInfo() : Promise.resolve(null),
  ]);
  if (typeof host.tabId !== 'number' || !all.some(t => t.id === host.tabId)) {
    throw new Error('There is no current tab to protect. No tabs were closed.');
  }
  // Zen deliberately identifies as Firefox; only its extra browser-info field
  // identifies Window Sync. WebExtensions expose no canonical shared-tab ID.
  if (info && ('zen' in info || /zen/i.test(info.name)) && windows.length > 1) {
    throw new Error('Zen shares tabs across windows. Use one browser window before bulk closing; no tabs were closed.');
  }
  if (windows.some(w => typeof w.id !== 'number')) throw new Error('Could not verify browser windows. No tabs were closed.');
  return { tabs: all, windows: windows.map(w => w.id!).sort((a, b) => a - b) };
}

function closingState(snapshot: ClosingSnapshot): string {
  return JSON.stringify([snapshot.windows, [...snapshot.tabs].sort((a, b) => a.id! - b.id!).map(t =>
    [t.id, t.windowId, t.index, t.url, (t as { pendingUrl?: string }).pendingUrl, t.pinned, t.active, t.hidden])]);
}

async function closeTabs(host: Host, action: 'close-duplicates' | 'close-others' | 'close-right', tabId?: number): Promise<void> {
  const snapshot = await closingSnapshot(host);
  const anchor = snapshot.tabs.find(t => t.id === target(host, tabId));
  if (!anchor) throw new Error('The selected tab changed. Try again; no tabs were closed.');
  const eligible = snapshot.tabs.filter(t => typeof t.id === 'number' && !t.hidden);
  const ids = action === 'close-duplicates'
    ? duplicateTabIds(eligible.map(t => ({ id: t.id!, url: t.url || '', pinned: !!t.pinned,
        active: !!t.active || t.id === host.tabId, lastAccessed: (t as { lastAccessed?: number }).lastAccessed || 0 })))
    : eligible.filter(t => t.windowId === anchor.windowId && t.id !== anchor.id && t.id !== host.tabId && !t.pinned && !t.active &&
        (action === 'close-others' || t.index > anchor.index)).map(t => t.id!);
  if (!ids.length) return;
  // Navigation, pinning, activation, reordering, or new windows invalidate the
  // whole plan. Never apply a list derived from an outdated browser snapshot.
  if (closingState(await closingSnapshot(host)) !== closingState(snapshot)) {
    throw new Error('Tabs changed. Try again; no tabs were closed.');
  }
  await browser.tabs.remove(ids);
}

let sitesCache: { at: number; sites: SiteInfo[] } | null = null;

export const ops = {
  tabs,

  async history(_host: Host, text: string): Promise<HistoryInfo[]> {
    const items = await browser.history.search({ text, maxResults: 80, startTime: Date.now() - 180 * DAY });
    return items.filter((i) => i.url).map((i) => ({
      url: i.url!,
      title: i.title || '',
      visitCount: i.visitCount || 0,
      typedCount: i.typedCount || 0,
      lastVisitTime: i.lastVisitTime || 0,
    }));
  },

  async bookmarks(_host: Host, text: string) {
    const items = await browser.bookmarks.search({ query: text });
    return items.filter((b) => b.url).slice(0, 60).map((b) => ({ url: b.url!, title: b.title || '' }));
  },

  async recentlyClosed(): Promise<ClosedTabInfo[]> {
    const sessions = await browser.sessions.getRecentlyClosed({ maxResults: 25 });
    const out: ClosedTabInfo[] = [];
    for (const s of sessions) {
      const t = s.tab as (typeof s.tab & { sessionId?: string }) | undefined;
      if (!t || !t.url || !t.sessionId || t.url.startsWith(extensionOrigin())) continue;
      // Chromium reports seconds, Firefox milliseconds.
      const closedAt = s.lastModified < 1e12 ? s.lastModified * 1000 : s.lastModified;
      out.push({ sessionId: t.sessionId, title: t.title || '', url: t.url, closedAt, favIconUrl: t.favIconUrl });
    }
    return out;
  },

  async sites(host: Host): Promise<SiteInfo[]> {
    const now = Date.now();
    if (sitesCache && now - sitesCache.at < 10 * 60_000) return sitesCache.sites;
    const [items, open] = await Promise.all([
      browser.history.search({ text: '', startTime: now - 14 * DAY, maxResults: 5000 }),
      tabs(host),
    ]);
    const sites = aggregateSites(items, open.map((t) => t.url));
    sitesCache = { at: now, sites };
    return sites;
  },

  async suggestions(_host: Host, text: string): Promise<string[]> {
    const res = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(text)}`, { credentials: 'omit' });
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[]];
    return Array.isArray(json?.[1]) ? json[1] : [];
  },

  async switchToTab(_host: Host, tabId: number, windowId?: number) {
    await browser.tabs.update(tabId, { active: true });
    if (typeof windowId === 'number') await browser.windows.update(windowId, { focused: true });
  },

  async open(host: Host, url: string, newTab: boolean) {
    if (newTab || typeof host.tabId !== 'number') {
      const index = typeof host.tabId === 'number' ? (await browser.tabs.get(host.tabId).catch(() => null))?.index : undefined;
      await browser.tabs.create({ url, active: true, ...(typeof index === 'number' ? { index: index + 1 } : {}) });
    } else {
      await browser.tabs.update(host.tabId, { url, active: true });
      if (typeof host.windowId === 'number') await browser.windows.update(host.windowId, { focused: true }).catch(() => {});
    }
  },

  /** Returns a PNG data URL for 'screenshot'; nothing otherwise. */
  async tabAction(host: Host, action: TabAction, tabId?: number): Promise<string | void> {
    sitesCache = null;
    if (action === 'new-tab') { await browser.tabs.create({}); return; }
    if (action === 'new-window') { await browser.windows.create({}); return; }
    if (action === 'close-duplicates' || action === 'close-others' || action === 'close-right') {
      await closeTabs(host, action, tabId);
      return;
    }
    const id = target(host, tabId);
    const tab = await browser.tabs.get(id);
    switch (action) {
      case 'reload': await browser.tabs.reload(id); return;
      case 'hard-reload': await browser.tabs.reload(id, { bypassCache: true }); return;
      case 'duplicate': await browser.tabs.duplicate(id); return;
      case 'pin': await browser.tabs.update(id, { pinned: true }); return;
      case 'unpin': await browser.tabs.update(id, { pinned: false }); return;
      case 'mute': await browser.tabs.update(id, { muted: true }); return;
      case 'unmute': await browser.tabs.update(id, { muted: false }); return;
      case 'close': await browser.tabs.remove(id); return;
      case 'move-to-new-window': await browser.windows.create({ tabId: id }); return;
      case 'back': await browser.tabs.goBack(id); return;
      case 'forward': await browser.tabs.goForward(id); return;
      case 'bookmark':
        if (!tab.url) throw new Error('This page has no address to bookmark');
        await browser.bookmarks.create({ title: tab.title || tab.url, url: tab.url });
        return;
      case 'view-source':
        if (!tab.url) throw new Error('This page has no source to show');
        await browser.tabs.create({ url: `view-source:${tab.url}`, index: tab.index + 1 });
        return;
      case 'screenshot':
        try {
          return await browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        } catch (err) {
          // Browsers only allow page capture right after you use the extension's
          // own shortcut or toolbar button (activeTab).
          if (/activeTab|all_urls|permission/i.test(String((err as Error)?.message))) {
            throw new Error('Open MoonCow with its toolbar button or browser shortcut, then try again');
          }
          throw err;
        }
    }
    throw new Error(`Unsupported action ${action}`);
  },

  async restoreClosed(_host: Host, sessionId?: string) {
    await browser.sessions.restore(sessionId);
  },

  async deleteHistory(_host: Host, url: string) {
    sitesCache = null;
    await browser.history.deleteUrl({ url });
  },

  async pageInfo(host: Host) {
    if (typeof host.tabId !== 'number') return null;
    const tab = await browser.tabs.get(host.tabId).catch(() => null);
    return tab?.url ? { url: tab.url, title: tab.title || '' } : null;
  },

  async pageText(host: Host): Promise<string> {
    if (typeof host.tabId !== 'number') return '';
    try {
      const page = (await browser.tabs.sendMessage(host.tabId, { type: 'mooncow:page-text' })) as PageText | undefined;
      if (!page) return '';
      return page.selection ? `Selected text:\n${page.selection}\n\nFull page:\n${page.text}` : page.text;
    } catch {
      return '';
    }
  },

  async openOptions() {
    await browser.runtime.openOptionsPage();
  },
};

export type OpName = keyof typeof ops;
type Rest<F> = F extends (host: Host, ...args: infer A) => unknown ? A : never;

export interface OpRequest<K extends OpName = OpName> {
  type: 'op';
  op: K;
  args: Rest<(typeof ops)[K]>;
  /** Explicit host for surfaces that are not inside the target tab (popup window, new tab). */
  host?: Host;
}

export type OpResponse = { ok: true; value: unknown } | { ok: false; error: string };

export async function handleOp(request: OpRequest, sender: { tab?: { id?: number; windowId?: number } }): Promise<OpResponse> {
  const host: Host = request.host ?? { tabId: sender.tab?.id ?? null, windowId: sender.tab?.windowId ?? null };
  const fn = ops[request.op] as ((host: Host, ...args: unknown[]) => Promise<unknown>) | undefined;
  if (!fn) return { ok: false, error: `Unknown operation ${request.op}` };
  try {
    return { ok: true, value: await fn(host, ...(request.args as unknown[])) };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message || String(err) };
  }
}
