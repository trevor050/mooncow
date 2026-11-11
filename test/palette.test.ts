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

it('cleans up an open view when the palette is hidden', () => {
  const palette = setup();
  const cleanup = vi.fn();
  palette.showView({ id: 'stream', title: 'Stream', mount: () => cleanup });
  palette.hide();
  expect(cleanup).toHaveBeenCalledOnce();
  palette.show();
  expect(document.activeElement).toBe(document.querySelector('.query'));
});

it('disconnects a streaming AI port when its view is hidden', async () => {
  const { fakeBrowser } = await import('wxt/testing/fake-browser');
  const { chatView } = await import('@/ui/views/chat-view');
  await fakeBrowser.storage.local.set({ settings: { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, baseUrl: 'http://127.0.0.1:12345/v1', model: 'mock' } } });
  const disconnect = vi.fn();
  const connect = vi.spyOn(fakeBrowser.runtime, 'connect').mockReturnValue({
    postMessage: vi.fn(), disconnect,
    onMessage: { addListener: vi.fn() }, onDisconnect: { addListener: vi.fn() },
  } as never);
  const palette = setup();
  palette.showView(chatView({ prompt: 'local test' }));
  await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
  palette.hide();
  expect(disconnect).toHaveBeenCalledOnce();
  connect.mockRestore();
  fakeBrowser.reset();
});
