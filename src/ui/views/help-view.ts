import type { View } from '@/core/types';
import { h } from '../dom';

/** Lists every registered tool, generated from the registry, with runnable examples. */
export function helpView(): View {
  return {
    id: 'help',
    title: 'What MoonCow can do',
    mount(root, ctx) {
      const list = h('div', { class: 'help' });
      for (const tool of ctx.tools) {
        const examples = h('div', { class: 'help-examples' });
        for (const ex of tool.examples || []) {
          if (ex.includes('…')) continue;
          const b = h('button', { class: 'chip mono', type: 'button' }, ex);
          b.addEventListener('click', () => ctx.setQuery(ex));
          examples.append(b);
        }
        list.append(h('section', { class: 'help-tool' }, h('h3', {}, tool.name), h('p', {}, tool.description), examples));
      }
      list.append(
        h('section', { class: 'help-tool' },
          h('h3', {}, 'Keys'),
          h('p', {}, '↑ ↓ move · Enter runs · Mod+Enter runs the second action · Mod+K lists every action · Tab completes a suggestion · Esc goes back or closes. Start with > for commands only, @ to pick a site.'),
        ),
      );
      root.append(list);
      (list.querySelector('button') as HTMLButtonElement | null)?.focus();
    },
  };
}
