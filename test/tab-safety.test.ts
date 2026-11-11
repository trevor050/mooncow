import { fakeBrowser } from 'wxt/testing/fake-browser';
import { duplicateTabIds, ops } from '@/lib/browser-ops';

const host = { tabId: 1, windowId: 10 };
const tab = (id: number, url: string, extra = {}) => ({ id, windowId: 10, index: id, url, active: id === 1, pinned: false, lastAccessed: id, ...extra });
let current: ReturnType<typeof tab>[];
const info = vi.fn<() => Promise<{ name: string; zen?: { version: string } }>>();

beforeEach(() => {
  fakeBrowser.reset();
  current = [tab(1, 'https://a.test/'), tab(2, 'https://a.test/'), tab(3, 'https://pinned.test/', { pinned: true }), tab(4, 'https://other.test/')];
  vi.spyOn(fakeBrowser.tabs, 'query').mockImplementation(async () => current as never);
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation(async (id) => current.find(t => t.id === id) as never);
  vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue();
  vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: 10, type: 'normal' }] as never);
  info.mockReset().mockResolvedValue({ name: 'Firefox' });
  Object.defineProperty(fakeBrowser.runtime, 'getBrowserInfo', { configurable: true, writable: true, value: info });
});

afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(fakeBrowser.runtime, 'getBrowserInfo'); });

it.each(['close-duplicates', 'close-others', 'close-right'] as const)('refuses %s in Zen with mirrored windows', async (action) => {
  info.mockResolvedValue({ name: 'Firefox', zen: { version: '1.24b' } });
  vi.mocked(fakeBrowser.windows.getAll).mockResolvedValue([{ id: 10, type: 'normal' }, { id: 20, type: 'normal' }] as never);
  current.push(tab(11, 'https://a.test/', { windowId: 20 }), tab(13, 'https://pinned.test/', { windowId: 20 }));
  await expect(ops.tabAction(host, action)).rejects.toThrow(/Zen|shared|mirror/i);
  expect(fakeBrowser.tabs.remove).not.toHaveBeenCalled();
});

it.each(['close-duplicates', 'close-others', 'close-right'] as const)('preserves the host and pins for %s in one window', async (action) => {
  await ops.tabAction(host, action);
  const removed = vi.mocked(fakeBrowser.tabs.remove).mock.calls.flatMap(([ids]) => Array.isArray(ids) ? ids : [ids]);
  expect(removed).not.toContain(1);
  expect(removed).not.toContain(3);
  expect(removed).toContain(2);
});

it('aborts the whole batch if a candidate becomes pinned before removal', async () => {
  const first = current.map(t => ({ ...t }));
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValueOnce(first as never).mockImplementation(async () => current.map(t => ({ ...t, pinned: t.id === 2 || t.pinned })) as never);
  await expect(ops.tabAction(host, 'close-duplicates')).rejects.toThrow(/changed|again/i);
  expect(fakeBrowser.tabs.remove).not.toHaveBeenCalled();
});

it('closes nothing without a known host tab', async () => {
  await expect(ops.tabAction({ tabId: null, windowId: null }, 'close-duplicates')).rejects.toThrow();
  expect(fakeBrowser.tabs.remove).not.toHaveBeenCalled();
});

it('protects every active tab, not just the first member of a duplicate group', () => {
  expect(duplicateTabIds([tab(1, 'https://a.test/'), tab(2, 'https://a.test/', { active: true }), tab(3, 'https://a.test/')])).toEqual([3]);
});

it('does not equate fragment state or significant trailing slashes', () => {
  expect(duplicateTabIds([tab(1, 'https://a.test/path#one'), tab(2, 'https://a.test/path#two'), tab(3, 'https://a.test/path/'), tab(4, 'https://a.test/path')])).toEqual([]);
});
