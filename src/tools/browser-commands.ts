import { Query } from '@/core/query';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type GlyphName, type Result, type TabAction } from '@/core/types';

interface Command {
  action: TabAction | 'copy-url' | 'copy-title' | 'reopen-closed';
  title: string;
  phrases: string[];
  glyph: GlyphName;
}

const COMMANDS: Command[] = [
  { action: 'reload', title: 'Reload page', phrases: ['reload', 'refresh', 'reload page', 'reload tab'], glyph: 'reload' },
  { action: 'hard-reload', title: 'Hard reload (bypass cache)', phrases: ['hard reload', 'hard refresh', 'reload without cache'], glyph: 'reload' },
  { action: 'duplicate', title: 'Duplicate tab', phrases: ['duplicate tab', 'duplicate', 'dupe tab'], glyph: 'tab' },
  { action: 'pin', title: 'Pin tab', phrases: ['pin tab', 'pin'], glyph: 'tab' },
  { action: 'unpin', title: 'Unpin tab', phrases: ['unpin tab', 'unpin'], glyph: 'tab' },
  { action: 'mute', title: 'Mute tab', phrases: ['mute tab', 'mute'], glyph: 'tab' },
  { action: 'unmute', title: 'Unmute tab', phrases: ['unmute tab', 'unmute'], glyph: 'tab' },
  { action: 'close', title: 'Close tab', phrases: ['close tab', 'close'], glyph: 'tab' },
  { action: 'close-others', title: 'Close other tabs', phrases: ['close other tabs', 'close others', 'close all other tabs'], glyph: 'tab' },
  { action: 'close-right', title: 'Close tabs to the right', phrases: ['close tabs to the right', 'close right'], glyph: 'tab' },
  { action: 'close-duplicates', title: 'Close duplicate tabs', phrases: ['close duplicate tabs', 'close duplicates', 'dedupe tabs', 'remove duplicate tabs'], glyph: 'tab' },
  { action: 'reopen-closed', title: 'Reopen closed tab', phrases: ['reopen closed tab', 'reopen tab', 'undo close tab', 'restore tab'], glyph: 'history' },
  { action: 'new-tab', title: 'New tab', phrases: ['new tab'], glyph: 'tab' },
  { action: 'new-window', title: 'New window', phrases: ['new window'], glyph: 'tab' },
  { action: 'move-to-new-window', title: 'Move tab to new window', phrases: ['move tab to new window', 'pop out tab', 'detach tab'], glyph: 'tab' },
  { action: 'back', title: 'Go back', phrases: ['back', 'go back'], glyph: 'tab' },
  { action: 'forward', title: 'Go forward', phrases: ['forward', 'go forward'], glyph: 'tab' },
  { action: 'bookmark', title: 'Bookmark this page', phrases: ['bookmark', 'bookmark this page', 'bookmark page', 'save page'], glyph: 'bookmark' },
  { action: 'view-source', title: 'View page source', phrases: ['view source', 'page source', 'source'], glyph: 'code' },
  { action: 'screenshot', title: 'Screenshot visible page', phrases: ['screenshot', 'take screenshot', 'capture screen'], glyph: 'camera' },
  { action: 'copy-url', title: 'Copy page URL', phrases: ['copy url', 'copy link', 'copy page url'], glyph: 'link' },
  { action: 'copy-title', title: 'Copy page title', phrases: ['copy title', 'copy page title'], glyph: 'text' },
];

/**
 * Exact phrase: explicit. Prefix of a phrase: relevance grows with how much
 * of the phrase has been typed, so "rel" stays below web search while
 * "reloa" moves above it.
 */
export function commandRelevance(query: { lower: string; is(...p: string[]): boolean; prefixOf(p: string[], min?: number): boolean }, phrases: string[]): number {
  if (query.is(...phrases)) return RELEVANCE.explicit;
  if (!query.prefixOf(phrases, 3)) return 0;
  const longest = Math.max(...phrases.filter((p) => p.startsWith(query.lower)).map((p) => p.length));
  return RELEVANCE.partial + 0.3 * (query.lower.length / longest);
}

function toResult(cmd: Command, relevance: number): Result {
  return {
    id: cmd.action,
    kind: 'command',
    title: cmd.title,
    icon: { glyph: cmd.glyph },
    accessory: 'Command',
    relevance,
    actions: [
      {
        title: cmd.title,
        async run(ctx) {
          if (cmd.action === 'reopen-closed') {
            await ctx.browser.restoreClosed();
            ctx.close();
            return;
          }
          if (cmd.action === 'copy-url' || cmd.action === 'copy-title') {
            const info = await ctx.browser.pageInfo();
            if (!info) return ctx.toast('No page to copy from');
            await ctx.copy(cmd.action === 'copy-url' ? info.url : info.title);
            ctx.toast('Copied');
            return;
          }
          await ctx.browser.tabAction(cmd.action);
          ctx.close();
        },
      },
    ],
  };
}

export default defineTool({
  id: 'browser-commands',
  name: 'Browser commands',
  description: 'Act on the current tab: reload, duplicate, pin, mute, bookmark, screenshot, copy URL.',
  examples: ['>', 'close duplicates', 'reopen closed tab', 'dupl', 'copy url'],
  match(q) {
    if (q.isEmpty) return null;
    // ">" scopes the bar to commands, like a code editor's command palette.
    if (q.text.startsWith('>')) {
      const rest = new Query(q.text.slice(1));
      return COMMANDS.map((c, i) => {
        if (rest.isEmpty) return toResult(c, RELEVANCE.explicit - i * 0.001);
        const words = rest.lower.split(' ');
        const hay = `${c.title} ${c.phrases.join(' ')}`.toLowerCase().split(/\W+/);
        const hit = words.every((w) => hay.some((h) => h.startsWith(w)));
        return hit ? toResult(c, RELEVANCE.explicit - i * 0.001) : null;
      }).filter((r): r is Result => r !== null);
    }
    return COMMANDS.map((c) => ({ c, r: commandRelevance(q, c.phrases) }))
      .filter((x) => x.r > 0)
      .map((x) => toResult(x.c, x.r));
  },
});
