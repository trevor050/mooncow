import { Query } from '@/core/query';
import { ToolRegistry } from '@/core/registry';
import type { DataSource, Result, Tool, ToolContext } from '@/core/types';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { BUILTIN_TOOLS } from '@/tools';

export const NOW = Date.UTC(2026, 10, 10, 15, 0, 0); // Tue 10 Nov 2026, 15:00 UTC

export function fakeData(overrides: Partial<DataSource> = {}): DataSource {
  return {
    tabs: async () => [],
    history: async () => [],
    bookmarks: async () => [],
    suggestions: async () => [],
    recentlyClosed: async () => [],
    sites: async () => [],
    lastChat: async () => null,
    ...overrides,
  };
}

export function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    signal: new AbortController().signal,
    now: NOW,
    settings: DEFAULT_SETTINGS,
    data: fakeData(),
    ...overrides,
  };
}

/** Results of one tool for a query, as an array. */
export async function run(tool: Tool, text: string, c: ToolContext = ctx()): Promise<Result[]> {
  const out = await tool.match(new Query(text), c);
  if (!out) return [];
  return Array.isArray(out) ? out : [out];
}

/** The full ranked list from every built-in tool. */
export async function runAll(text: string, c: ToolContext = ctx()): Promise<Result[]> {
  return new ToolRegistry().register(...BUILTIN_TOOLS).run(text, c);
}

/** Resolve a result's hydrate step against canned JSON responses keyed by URL substring. */
export async function hydrate(result: Result, responses: Record<string, unknown>): Promise<Result> {
  if (!result.hydrate) return result;
  const patch = await result.hydrate({
    signal: new AbortController().signal,
    async fetchJson(url: string) {
      const key = Object.keys(responses).find((k) => url.includes(k));
      if (!key) throw new Error(`unexpected fetch ${url}`);
      return responses[key] as never;
    },
  });
  return { ...result, ...(patch || {}) };
}
