import { openAction, openInNewTabAction, searchAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { favicon } from './_helpers';

// Web search fallback, typed URLs, and Google's search suggestions.

const TLD = /\.(?:[a-z]{2,24}|xn--[a-z0-9-]+)$/i;

/** Turn something URL-shaped into a URL, or return null. */
export function toUrl(text: string): string | null {
  const t = text.trim();
  if (!t || /\s/.test(t)) return null;
  if (/^(https?|ftp|file|about|chrome|moz-extension|chrome-extension):/i.test(t)) {
    try {
      return new URL(t).href;
    } catch {
      return null;
    }
  }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i.test(t)) return `http://${t}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(t)) return `http://${t}`;
  const host = t.split(/[/?#]/)[0].replace(/:\d+$/, '');
  if (!host.includes('.') || !TLD.test(host) || /^\./.test(host) || /\.\./.test(host)) return null;
  if (!/^[a-z0-9.-]+$/i.test(host)) return null;
  // "e.g" and "i.e" are not domains; a real TLD is at least 2 letters and the label before it non-empty.
  try {
    return new URL(`https://${t}`).href;
  } catch {
    return null;
  }
}

function suggestionResult(text: string, index: number): Result {
  return {
    id: `suggest:${text}`,
    kind: 'suggestion',
    title: text,
    icon: { glyph: 'search' },
    relevance: RELEVANCE.weak + 0.1 - index * 0.02,
    actions: [searchAction(text, 'Search'), openInNewTabAction(`https://www.google.com/search?q=${encodeURIComponent(text)}`, 'Search in new tab')],
  };
}

export default defineTool({
  id: 'web',
  name: 'Web',
  description: 'Open typed addresses, search Google, and show search suggestions.',
  examples: ['github.com/trevor050', 'localhost:5173', 'site react hooks', 'best ramen in boston'],
  async match(q, ctx) {
    if (q.isEmpty || q.text.startsWith('>')) return null;
    const results: Result[] = [];

    // "site react hooks" / "search this site for react hooks": Google, limited to the current site.
    const onSite = q.commandWithArg('site', 'search this site for', 'search this site', 'on this site');
    if (onSite) {
      results.push({
        id: 'site',
        kind: 'command',
        title: onSite,
        subtitle: 'Search this site',
        icon: { glyph: 'search' },
        relevance: RELEVANCE.explicit,
        actions: [
          {
            title: 'Search this site',
            async run(ctx) {
              const page = await ctx.browser.pageInfo();
              let host = '';
              try { host = page ? new URL(page.url).hostname : ''; } catch {}
              if (!host) return ctx.toast('This page has no site to search');
              await ctx.open(`https://www.google.com/search?q=${encodeURIComponent(`site:${host} ${onSite}`)}`);
            },
          },
        ],
      });
    }
    const url = toUrl(q.text);
    if (url) {
      results.push({
        id: 'url',
        kind: 'navigation',
        title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        subtitle: 'Open address',
        url,
        icon: favicon(url),
        relevance: /^[a-z]+:/i.test(q.text) ? RELEVANCE.explicit : RELEVANCE.strong + 0.05,
        actions: [openAction(url), openInNewTabAction(url)],
      });
    }
    results.push({
      id: 'search',
      kind: 'search',
      title: q.text,
      subtitle: 'Search Google',
      icon: { glyph: 'search' },
      relevance: RELEVANCE.fallback,
      actions: [searchAction(q.text, 'Search'), openInNewTabAction(`https://www.google.com/search?q=${encodeURIComponent(q.text)}`, 'Search in new tab')],
    });
    if (!ctx.settings.suggestions || url || q.text.length < 2) return results;
    try {
      const suggestions = await ctx.data.suggestions(q.text);
      suggestions
        .filter((s) => s.toLowerCase() !== q.lower)
        .slice(0, 5)
        .forEach((s, i) => results.push(suggestionResult(s, i)));
    } catch {}
    return results;
  },
});
