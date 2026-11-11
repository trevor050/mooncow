// Small conveniences shared by the built-in tools. Third-party tools can use
// them too; they only build plain Result objects.
import { copyAction } from '@/core/actions';
import { RELEVANCE, type GlyphName, type Icon, type Result } from '@/core/types';

export function answer(opts: {
  id: string;
  title: string;
  answer: string;
  glyph: GlyphName;
  relevance?: number;
  copy?: string;
  subtitle?: string;
}): Result {
  const copyText = opts.copy ?? opts.answer;
  return {
    id: opts.id,
    kind: 'answer',
    title: opts.title,
    answer: opts.answer,
    subtitle: opts.subtitle,
    icon: { glyph: opts.glyph },
    relevance: opts.relevance ?? RELEVANCE.parsed,
    accessory: 'Copy',
    actions: [copyAction(copyText)],
  };
}

export function favicon(urlOrDomain: string): Icon {
  return { site: urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}/` };
}

/** Every query word must start some word of the haystack (title or URL parts). */
export function wordPrefixMatch(query: string, haystack: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const hayWords = haystack.toLowerCase().split(/[^a-z0-9À-￿]+/).filter(Boolean);
  return words.every((w) => hayWords.some((h) => h.startsWith(w)));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
