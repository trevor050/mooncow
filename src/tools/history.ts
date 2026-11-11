// History and bookmarks: frequent destinations, past searches, and pages,
// ranked by frecency. The domain autofill model (open tabs, typed visits,
// days active, fast recency decay) is carried over from MoonCow's original
// "site index", which always put a typed domain prefix first.
import { copyAction, openAction, openInNewTabAction, searchAction } from '@/core/actions';
import { fuzzyMatch } from '@/core/fuzzy';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Action, type BookmarkInfo, type HistoryInfo, type Result, type SiteInfo } from '@/core/types';
import { favicon } from './_helpers';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Exponential-decay frecency: visits count for less as they age (30-day half-life); typed visits count triple. */
export function frecency(item: Pick<HistoryInfo, 'visitCount' | 'typedCount' | 'lastVisitTime'>, now: number): number {
  const ageDays = Math.max(0, (now - item.lastVisitTime) / DAY);
  return (item.visitCount + 2 * item.typedCount) * Math.pow(0.5, ageDays / 30);
}

/** Domain score from the original site index: steady daily use and recency dominate. */
export function siteScore(site: SiteInfo, now: number): number {
  const ageDays = Math.max(0, (now - site.lastVisitTime) / DAY);
  const recency = Math.pow(0.5, ageDays / 2.5);
  return site.openCount * 7000 + site.typedCount * 1200 + site.visitCount * 300 + Math.pow(site.daysActive, 1.2) * 3500 + recency * 25000;
}

/**
 * Typing the start of a domain you use offers it first, like URL autofill.
 * Domains with an open tab are skipped: switching to the tab beats opening it again.
 */
export function autofillSite(sites: SiteInfo[], query: string, now: number): SiteInfo | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2 || /[\s/]/.test(q)) return null;
  const candidates = sites.filter((s) => s.domain.startsWith(q) && s.domain !== q && (s.visitCount >= 2 || s.typedCount >= 1));
  if (!candidates.length) return null;
  const best = candidates.sort((a, b) => siteScore(b, now) - siteScore(a, now))[0];
  return best.openCount > 0 ? null : best;
}

/** Match quality sets the base, heavy use lifts it: a page you use daily can beat web search, a one-off visit cannot. */
export function historyRelevance(quality: number, frec: number): number {
  if (quality <= 0) return 0;
  const usage = Math.min(0.12, Math.log10(1 + frec) / 12);
  const base = quality >= 0.95 ? 0.62 : quality >= 0.85 ? 0.58 : quality >= 0.7 ? 0.52 : 0.42;
  return base + usage;
}

/** The query of a Google search results URL, or null. */
export function googleSearchQuery(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)google\.[a-z.]+$/.test(u.hostname) || u.pathname !== '/search') return null;
    const q = u.searchParams.get('q');
    return q && q.trim() ? q.trim() : null;
  } catch {
    return null;
  }
}

function ago(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min ago`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h ago`;
  return `${Math.round(ms / DAY)} d ago`;
}

function pageResult(kind: 'history' | 'bookmark', item: { url: string; title: string }, relevance: number, accessory?: string, extra: Action[] = []): Result {
  return {
    id: `${kind}:${item.url}`,
    kind,
    title: item.title || item.url,
    subtitle: item.url.replace(/^https?:\/\/(www\.)?/, ''),
    url: item.url,
    icon: kind === 'bookmark' ? { glyph: 'bookmark' } : favicon(item.url),
    accessory,
    relevance,
    actions: [openAction(item.url), openInNewTabAction(item.url), copyAction(item.url, 'Copy URL'), ...extra],
  };
}

export default defineTool({
  id: 'history',
  name: 'History and bookmarks',
  description: 'Frequent sites, past searches, bookmarks and pages you visited, ranked by how often and how recently you use them.',
  examples: ['gith', 'wxt docs', 'ramen'],
  async match(q, ctx) {
    if (q.text.length < 2 || /^[>@=?]/.test(q.text)) return null;
    const [history, bookmarks, sites] = await Promise.all([
      ctx.data.history(q.text).catch(() => [] as HistoryInfo[]),
      ctx.data.bookmarks(q.text).catch(() => [] as BookmarkInfo[]),
      ctx.data.sites().catch(() => [] as SiteInfo[]),
    ]);
    const results: Result[] = [];
    const now = ctx.now;

    const site = autofillSite(sites, q.text, now);
    if (site) {
      const url = `https://${site.domain}/`;
      results.push({
        id: `autofill:${site.domain}`,
        kind: 'navigation',
        title: site.domain,
        subtitle: now - site.lastVisitTime < 6 * HOUR ? `Visited ${ago(now - site.lastVisitTime)}` : 'Frequent destination',
        url,
        icon: favicon(site.domain),
        relevance: 0.92,
        actions: [openAction(url), openInNewTabAction(url), copyAction(url, 'Copy URL')],
      });
    }

    bookmarks
      .filter((b) => b.url)
      .map((b) => ({ b, quality: fuzzyMatch(q.text, b) }))
      .filter((x) => x.quality >= 0.7)
      .sort((a, b) => b.quality - a.quality)
      .slice(0, 4)
      .forEach(({ b, quality }) => results.push(pageResult('bookmark', b, quality >= 0.95 ? RELEVANCE.strong - 0.02 : RELEVANCE.fallback - 0.02, 'Bookmark')));

    // Past Google searches that extend what you are typing: private, local completions.
    const searches = new Map<string, number>();
    for (const h of history) {
      const past = googleSearchQuery(h.url);
      if (!past || past.toLowerCase() === q.lower || !past.toLowerCase().startsWith(q.lower)) continue;
      searches.set(past, Math.max(searches.get(past) || 0, h.lastVisitTime));
    }
    [...searches.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .forEach(([text, at], i) =>
        results.push({
          id: `searched:${text.toLowerCase()}`,
          kind: 'suggestion',
          title: text,
          subtitle: 'You searched this',
          icon: { glyph: 'history' },
          accessory: ago(now - at),
          relevance: 0.66 - i * 0.01,
          actions: [searchAction(text, 'Search again'), { title: 'Edit query', run: (c) => c.setQuery(text) }],
        }),
      );

    history
      .filter((h) => h.url && !googleSearchQuery(h.url))
      .map((h) => ({ h, r: historyRelevance(fuzzyMatch(q.text, h), frecency(h, now)) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .slice(0, 5)
      .forEach(({ h, r }) =>
        results.push(
          pageResult('history', h, r, now - h.lastVisitTime < 6 * HOUR ? ago(now - h.lastVisitTime) : undefined, [
            { title: 'Remove from history', run: async (c) => { await c.browser.deleteHistory(h.url); c.toast('Removed from history'); c.refresh(); } },
          ]),
        ),
      );
    return results;
  },
});
