// Open tabs across every window. The most important tool in MoonCow: typing a
// few letters of anything you have open and pressing Enter should beat
// hunting through the tab strip.
import { copyAction } from '@/core/actions';
import { fuzzyMatch } from '@/core/fuzzy';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Action, type Result, type TabAction, type TabInfo } from '@/core/types';
import { favicon, hostOf } from './_helpers';

/** Map match quality to relevance: a solid tab match outranks web search (0.70). */
export function tabRelevance(quality: number): number {
  if (quality >= 0.95) return 0.86 + (quality - 0.95) * 0.4;
  if (quality >= 0.85) return 0.78;
  if (quality >= 0.7) return 0.72;
  if (quality > 0) return 0.45 + (quality - 0.4) * 0.5;
  return 0;
}

export function tabActions(tab: TabInfo): Action[] {
  const act = (title: string, action: TabAction): Action => ({
    title,
    run: async (ctx) => {
      await ctx.browser.tabAction(action, tab.id);
      ctx.toast(`${title} done`);
      ctx.refresh();
    },
  });
  return [
    { title: 'Switch to tab', run: async (ctx) => { await ctx.browser.switchToTab(tab.id, tab.windowId); ctx.close(); } },
    act('Close tab', 'close'),
    tab.pinned ? act('Unpin tab', 'unpin') : act('Pin tab', 'pin'),
    tab.muted ? act('Unmute tab', 'unmute') : act('Mute tab', 'mute'),
    act('Duplicate tab', 'duplicate'),
    act('Move to new window', 'move-to-new-window'),
    act('Reload tab', 'reload'),
    copyAction(tab.url, 'Copy URL'),
  ];
}

function tabResult(tab: TabInfo, relevance: number, windowCount: number): Result {
  const flags = [tab.pinned && 'Pinned', tab.audible && !tab.muted && 'Playing', tab.muted && 'Muted', windowCount > 1 && 'Other window']
    .filter(Boolean)
    .join(' · ');
  return {
    id: `tab:${tab.id}`,
    kind: 'tab',
    title: tab.title || tab.url,
    subtitle: hostOf(tab.url) || tab.url,
    url: tab.url,
    icon: tab.favIconUrl && /^(https?|data):/.test(tab.favIconUrl) ? { image: tab.favIconUrl } : favicon(tab.url),
    accessory: flags || 'Switch to tab',
    relevance,
    actions: tabActions(tab),
  };
}

export default defineTool({
  id: 'tabs',
  name: 'Open tabs',
  description: 'Every open tab in every window, fuzzy on title and address. Enter switches; Mod+K closes, pins, mutes or moves it.',
  examples: ['gmail', 'pr review', 'gml'],
  async match(q, ctx) {
    if (q.text.startsWith('>')) return null;
    const tabs = await ctx.data.tabs();
    const activeWindow = tabs.find((t) => t.active)?.windowId;
    const windows = new Set(tabs.map((t) => t.windowId)).size;
    const others = tabs.filter((t) => !(t.active && t.windowId === activeWindow));
    const mark = (t: TabInfo, r: number) => tabResult(t, r, windows > 1 && t.windowId !== activeWindow ? 2 : 1);

    if (q.isEmpty) {
      return others
        .sort((a, b) => b.lastAccessed - a.lastAccessed)
        .slice(0, 6)
        .map((t, i) => mark(t, RELEVANCE.partial + 0.1 - i * 0.01));
    }
    const now = ctx.now;
    return others
      .map((t) => {
        const quality = fuzzyMatch(q.text, t);
        // Recently used tabs win ties: up to +0.02 for tabs touched in the last hour.
        const recency = Math.max(0, 1 - (now - t.lastAccessed) / 3_600_000) * 0.02;
        return { t, r: quality ? tabRelevance(quality) + recency : 0 };
      })
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .slice(0, 5)
      .map(({ t, r }) => mark(t, r));
  },
});
