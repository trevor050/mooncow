// Fuzzy matching for things with a title and a URL (tabs, bookmarks, history).
// Returns a quality in [0, 1]; tools map it onto their relevance band.
//
//   1.00  the title or domain is exactly the query
//   0.95  the title or domain starts with the query
//   0.85  every query word starts a word in the title or URL
//   0.70  the query appears inside the title or URL
//   0.40-0.60  the query's letters appear in order in the title ("gml" -> Gmail)
//   0     no match

export interface Matchable {
  title: string;
  url?: string;
}

const splitWords = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function host(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

/** Score an in-order character match: compact matches that start words score higher. */
export function subsequenceScore(query: string, text: string): number {
  const q = query.replace(/\s+/g, '').toLowerCase();
  const t = text.toLowerCase();
  if (q.length < 3 || q.length > t.length) return 0;
  let ti = 0;
  let first = -1;
  let last = -1;
  let wordStarts = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return 0;
    if (first < 0) first = found;
    if (found === 0 || /[^\p{L}\p{N}]/u.test(t[found - 1])) wordStarts++;
    last = found;
    ti = found + 1;
  }
  const span = last - first + 1;
  const compactness = q.length / span;
  const starts = wordStarts / q.length;
  return 0.4 + 0.2 * Math.min(1, compactness * 0.7 + starts * 0.3);
}

export function fuzzyMatch(query: string, item: Matchable): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return 0;
  const title = item.title.toLowerCase();
  const h = host(item.url);
  const url = (item.url || '').toLowerCase().replace(/^[a-z]+:\/\/(www\.)?/, '');

  if (title === q || h === q) return 1;
  if (title.startsWith(q) || h.startsWith(q) || url.startsWith(q)) return 0.95;

  const qWords = q.split(' ');
  const hayWords = [...splitWords(item.title), ...splitWords(url)];
  if (qWords.every((w) => hayWords.some((hw) => hw.startsWith(w)))) return 0.85;

  if (q.length >= 3 && (title.includes(q) || url.includes(q))) return 0.7;

  return Math.max(subsequenceScore(q, item.title), subsequenceScore(q, h));
}
