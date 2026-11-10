// Tabs you closed recently, restorable with their history intact (sessions API).
import { copyAction } from '@/core/actions';
import { fuzzyMatch } from '@/core/fuzzy';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type ClosedTabInfo, type Result } from '@/core/types';
import { favicon, hostOf } from './_helpers';

function ago(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function closedResult(tab: ClosedTabInfo, relevance: number, now: number): Result {
  return {
    id: `closed:${tab.sessionId}`,
    kind: 'tab',
    title: tab.title || tab.url,
    subtitle: `${hostOf(tab.url)} · closed ${ago(now - tab.closedAt)}`,
    url: tab.url,
    icon: tab.favIconUrl && /^(https?|data):/.test(tab.favIconUrl) ? { image: tab.favIconUrl } : favicon(tab.url),
    accessory: 'Reopen',
    relevance,
    actions: [
      { title: 'Reopen tab', run: async (ctx) => { await ctx.browser.restoreClosed(tab.sessionId); ctx.close(); } },
      { title: 'Open fresh in new tab', run: (ctx) => ctx.open(tab.url, { newTab: true }) },
      copyAction(tab.url, 'Copy URL'),
    ],
  };
}

export default defineTool({
  id: 'recently-closed',
  name: 'Recently closed',
  description: 'Tabs you closed recently. Reopening restores their back/forward history.',
  examples: ['closed', 'reopen gmail'],
  async match(q, ctx) {
    if (q.text.startsWith('>')) return null;
    const scoped = q.command('closed', 'reopen', 'recently closed', 'undo close');
    if (q.isEmpty) return null;
    const closed = await ctx.data.recentlyClosed();
    if (scoped !== null) {
      return closed
        .filter((t) => !scoped || fuzzyMatch(scoped, t) > 0)
        .slice(0, 8)
        .map((t, i) => closedResult(t, RELEVANCE.explicit - i * 0.005, ctx.now));
    }
    // Unscoped: closed tabs rank just under open tabs and above history.
    return closed
      .map((t) => ({ t, quality: fuzzyMatch(q.text, t) }))
      .filter((x) => x.quality >= 0.7)
      .slice(0, 2)
      .map(({ t, quality }) => closedResult(t, quality >= 0.95 ? RELEVANCE.fallback + 0.03 : RELEVANCE.partial + 0.12, ctx.now));
  },
});
