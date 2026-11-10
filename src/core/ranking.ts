import type { Result, ResultKind } from './types';

// Final score = relevance (0..1) × 1000 + kind tie-break (0..9) + learned boost (0..40).
// Relevance bands are 50-100 points apart, so the learned boost can reorder
// results within a band but never lift a loose match over a precise one.

const KIND_TIEBREAK: Record<ResultKind, number> = {
  answer: 9,
  command: 8,
  tab: 7,
  navigation: 6,
  bookmark: 5,
  history: 4,
  ai: 3,
  search: 2,
  suggestion: 1,
};

export const MAX_LEARNED_BOOST = 40;
export const MAX_RESULTS = 9;

/** Counts of which tool the user picked, keyed by the first characters of the query. */
export type PickStats = Record<string, Record<string, number>>;

export function statsKey(query: string): string {
  return query.trim().toLowerCase().slice(0, 3);
}

export function learnedBoost(stats: PickStats, query: string, toolId: string | undefined): number {
  if (!toolId) return 0;
  const bucket = stats[statsKey(query)];
  if (!bucket || !bucket[toolId]) return 0;
  const max = Math.max(...Object.values(bucket));
  return (bucket[toolId] / max) * MAX_LEARNED_BOOST;
}

export function recordPick(stats: PickStats, query: string, toolId: string): PickStats {
  const key = statsKey(query);
  if (!key) return stats;
  const bucket = { ...(stats[key] || {}) };
  bucket[toolId] = (bucket[toolId] || 0) + 1;
  return { ...stats, [key]: bucket };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function scoreResult(result: Result, query: string, stats: PickStats = {}): number {
  return clamp01(result.relevance) * 1000 + KIND_TIEBREAK[result.kind] + learnedBoost(stats, query, result.toolId);
}

// Results that point at the same page collapse into one; an open tab beats a
// history entry for the same URL because switching is cheaper than reloading.
function urlKey(result: Result): string | null {
  if (!['tab', 'navigation', 'history', 'bookmark'].includes(result.kind)) return null;
  const url = result.url;
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + u.search).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function rank(results: Result[], query: string, stats: PickStats = {}, limit = MAX_RESULTS): Result[] {
  const scored = results.map((r) => ({ ...r, score: scoreResult(r, query, stats) }));
  scored.sort((a, b) => (b.score! - a.score!) || a.title.localeCompare(b.title));

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const out: Result[] = [];
  for (const r of scored) {
    const key = urlKey(r);
    if (key) {
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
    }
    // Suggestions often repeat the query or each other; one copy is enough.
    if (r.kind === 'suggestion') {
      const t = r.title.toLowerCase();
      if (seenTitles.has(t)) continue;
      seenTitles.add(t);
    }
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
