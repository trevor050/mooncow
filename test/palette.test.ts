import { ToolRegistry } from '@/core/registry';
import type { PaletteEnv } from '@/ui/palette';
import { Palette } from '@/ui/palette';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { fakeData } from './helpers';

function setup() {
  const env: PaletteEnv = {
    registry: new ToolRegistry().register({
      id: 'test-row', name: 'Test row', description: 'A row with keyboard actions.',
      match: () => ({ id: 'row', kind: 'command', title: 'Test row', relevance: 1, actions: [{ title: 'First', run() {} }, { title: 'Second', run() {} }] }),
    }),
    data: fakeData(), bridge: {} as PaletteEnv['bridge'], settings: () => DEFAULT_SETTINGS,
    stats: {}, saveStats() {}, close() {}, copy: async () => {}, open: async () => {},
  };
  const palette = new Palette(env);
  document.body.append(palette.root);
  palette.show();
  return palette;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  document.body.replaceChildren();
});

it('focuses the action menu on the first Ctrl+K so arrows act on it', () => {
  setup();
  const input = document.querySelector<HTMLInputElement>('.query')!;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  expect(document.activeElement).toBe(document.querySelector('.menu'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  expect(document.querySelector('.menu-item.selected')?.textContent).toContain('Second');
});
