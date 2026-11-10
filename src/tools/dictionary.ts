import { copyAction, openAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type HydrateContext, type Result } from '@/core/types';

// Definitions and spelling from Wiktionary's REST API (keyless, CORS-enabled),
// with Datamuse as a spelling fallback for words Wiktionary does not have.

interface WiktionaryEntry {
  partOfSpeech: string;
  definitions: { definition: string }[];
}

const stripTags = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

async function wiktionary(word: string, ctx: HydrateContext): Promise<WiktionaryEntry[] | null> {
  try {
    const data = await ctx.fetchJson<Record<string, WiktionaryEntry[]>>(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
    );
    return data.en || null;
  } catch {
    return null;
  }
}

export function misspellingTarget(entries: WiktionaryEntry[] | null): string | null {
  for (const entry of entries || []) {
    for (const d of entry.definitions) {
      const m = stripTags(d.definition).match(/^(?:Common\s+)?misspelling of ([\p{L}' -]+?)\.?$/iu);
      if (m) return m[1].trim();
    }
  }
  return null;
}

export function firstDefinition(entries: WiktionaryEntry[] | null): { pos: string; text: string } | null {
  for (const entry of entries || []) {
    for (const d of entry.definitions) {
      const text = stripTags(d.definition);
      if (text && !/^(?:Common\s+)?misspelling of/i.test(text)) return { pos: entry.partOfSpeech, text };
    }
  }
  return null;
}

const WORD = /^[\p{L}][\p{L}'’ -]{0,40}$/u;

function defineResult(word: string, relevance: number): Result {
  const more = openAction(`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`, 'Open in Wiktionary');
  return {
    id: `define:${word.toLowerCase()}`,
    kind: 'answer',
    title: word,
    answer: 'Looking it up…',
    icon: { glyph: 'book' },
    relevance,
    actions: [more],
    async hydrate(ctx) {
      const entries = await wiktionary(word, ctx);
      const target = misspellingTarget(entries);
      const def = firstDefinition(entries);
      if (def) return { subtitle: def.pos, answer: def.text, accessory: 'Copy', actions: [copyAction(def.text), more] };
      if (target) return { answer: `Did you mean “${target}”?`, actions: [{ title: `Define ${target}`, run: (c) => c.setQuery(`define ${target}`) }, more] };
      return { answer: 'No definition found', actions: [more] };
    },
  };
}

function spellResult(word: string): Result {
  return {
    id: `spell:${word.toLowerCase()}`,
    kind: 'answer',
    title: `Spelling of “${word}”`,
    answer: 'Checking…',
    icon: { glyph: 'book' },
    relevance: RELEVANCE.explicit,
    actions: [],
    async hydrate(ctx) {
      const entries = await wiktionary(word, ctx);
      const target = misspellingTarget(entries);
      if (target) return { answer: target, subtitle: `“${word}” is a misspelling`, accessory: 'Copy', actions: [copyAction(target)] };
      if (firstDefinition(entries)) return { answer: word, subtitle: 'Spelled correctly', accessory: 'Copy', actions: [copyAction(word)] };
      const [sp, sl] = await Promise.all([
        ctx.fetchJson<{ word: string }[]>(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&max=1`).catch(() => []),
        ctx.fetchJson<{ word: string }[]>(`https://api.datamuse.com/words?sl=${encodeURIComponent(word)}&max=1`).catch(() => []),
      ]);
      const guess = sp[0]?.word || sl[0]?.word;
      if (!guess) return { answer: 'No suggestion', subtitle: undefined };
      return { answer: guess, subtitle: guess === word.toLowerCase() ? 'Spelled correctly' : 'Closest match', accessory: 'Copy', actions: [copyAction(guess)] };
    },
  };
}

export default defineTool({
  id: 'dictionary',
  name: 'Dictionary',
  description: 'Definitions and spelling checks from Wiktionary.',
  examples: ['define serendipity', 'what does ephemeral mean', 'spell definately', 'how to spell accommodate'],
  match(q) {
    const spell =
      q.commandWithArg('spell', 'spelling of', 'how to spell', 'how do you spell', 'spellcheck') ??
      q.match(/^(.+?)\s+spelling$/i)?.[1] ??
      null;
    if (spell && WORD.test(spell)) return spellResult(spell.replace(/[?"“”]/g, '').trim());

    const word =
      q.commandWithArg('define', 'def', 'definition of', 'meaning of', 'dict') ??
      q.match(/^what does (.+?) mean\??$/i)?.[1] ??
      q.match(/^(.+?)\s+(?:definition|meaning)$/i)?.[1] ??
      null;
    if (word && WORD.test(word)) return defineResult(word.replace(/[?"“”]/g, '').trim(), RELEVANCE.explicit);
    return null;
  },
});
