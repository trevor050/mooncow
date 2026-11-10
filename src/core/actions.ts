// Ready-made actions most tools need.
import type { Action } from './types';

export function copyAction(text: string, title = 'Copy'): Action {
  return {
    title,
    async run(ctx) {
      await ctx.copy(text);
      ctx.toast('Copied');
    },
  };
}

export function openAction(url: string, title = 'Open'): Action {
  return { title, run: (ctx) => ctx.open(url) };
}

export function openInNewTabAction(url: string, title = 'Open in new tab'): Action {
  return { title, run: (ctx) => ctx.open(url, { newTab: true }) };
}

export function searchAction(query: string, title = 'Search Google'): Action {
  return openAction(`https://www.google.com/search?q=${encodeURIComponent(query)}`, title);
}
