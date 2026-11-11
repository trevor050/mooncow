import { openAction, openInNewTabAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { ENGINES, engineByAlias, engineUrl, isSuffixAlias, type Engine } from '@/lib/engines';
import { favicon } from './_helpers';

function searchResult(engine: Engine, term: string, relevance: number): Result {
  const url = engineUrl(engine, term);
  return {
    id: `${engine.key}:${term}`,
    kind: 'command',
    title: term,
    subtitle: `Search ${engine.name}`,
    icon: favicon(engine.domain),
    relevance,
    actions: [openAction(url, `Search ${engine.name}`), openInNewTabAction(url)],
  };
}

export default defineTool({
  id: 'app-search',
  name: 'Site search',
  description: 'Search a site directly: “@yt lofi”, “@gh wxt”, or end with the site name (“lofi youtube”).',
  examples: ['@yt lofi beats', '@gh wxt-dev/wxt', 'useEffect mdn', '@'],
  match(q) {
    // "@" or "@yo": list engines to complete.
    const partial = q.text.match(/^@([a-z]*)$/i);
    if (partial) {
      const prefix = partial[1].toLowerCase();
      return ENGINES.filter((e) => !prefix || e.aliases.some((a) => a.startsWith(prefix)) || e.name.toLowerCase().startsWith(prefix))
        .slice(0, 9)
        .map((e, i) => ({
          id: `pick:${e.key}`,
          kind: 'command' as const,
          title: e.name,
          subtitle: e.aliases.map((a) => `@${a}`).join('  '),
          icon: favicon(e.domain),
          relevance: RELEVANCE.explicit - i * 0.001,
          actions: [{ title: 'Choose', run: (ctx) => ctx.setQuery(`@${e.aliases[0]} `) }],
        }));
    }

    const explicit = q.text.match(/^@([a-z]+)\s+(.+)$/i);
    if (explicit) {
      const engine = engineByAlias(explicit[1]);
      return engine ? searchResult(engine, explicit[2], RELEVANCE.explicit) : null;
    }

    // Trailing site name: "lofi youtube". Full names rank above web search;
    // short aliases ("lofi yt") sit just below it so a stray word is cheap.
    const last = q.words[q.words.length - 1]?.toLowerCase();
    if (q.words.length >= 2 && last && isSuffixAlias(last)) {
      const engine = engineByAlias(last)!;
      const term = q.text.slice(0, q.text.length - last.length).trim();
      const isFullName = engine.name.toLowerCase().replace(/\s+/g, '') === last || engine.key === last;
      return searchResult(engine, term, isFullName ? RELEVANCE.fallback + 0.05 : RELEVANCE.fallback - 0.05);
    }
    return null;
  },
});
