import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as browserOps from '@/lib/browser-ops';

const host = { tabId: 1, windowId: 1 };
const visit = { id: '1', url: 'https://github.com/docs', visitCount: 8, typedCount: 2, lastVisitTime: Date.now() };
let module: typeof browserOps;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.resetModules();
  module = await import('@/lib/browser-ops');
  vi.spyOn(fakeBrowser.history, 'search').mockResolvedValue([] as never);
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
  for (const event of [fakeBrowser.history.onVisited, fakeBrowser.history.onVisitRemoved, fakeBrowser.tabs.onCreated, fakeBrowser.tabs.onRemoved, fakeBrowser.tabs.onUpdated]) {
    vi.spyOn(event, 'addListener').mockImplementation(() => {});
  }
});
afterEach(() => vi.restoreAllMocks());

it('refreshes a warm index immediately when history gains a frequent site', async () => {
  const listener = vi.spyOn(fakeBrowser.history.onVisited, 'addListener');
  module.watchSiteChanges();
  expect(await module.ops.sites(host)).toEqual([]);
  vi.mocked(fakeBrowser.history.search).mockResolvedValue([visit] as never);
  listener.mock.calls[0][0](visit);
  expect((await module.ops.sites(host)).map(s => s.domain)).toContain('github.com');
});

it('removes a deleted site from a warm index', async () => {
  const listener = vi.spyOn(fakeBrowser.history.onVisitRemoved, 'addListener');
  module.watchSiteChanges();
  vi.mocked(fakeBrowser.history.search).mockResolvedValue([visit] as never);
  await module.ops.sites(host);
  vi.mocked(fakeBrowser.history.search).mockResolvedValue([] as never);
  listener.mock.calls[0][0]({ allHistory: false, urls: [visit.url] });
  expect(await module.ops.sites(host)).toEqual([]);
});

it('does not restore an obsolete cache fill after a visit occurs during its fetch', async () => {
  const listener = vi.spyOn(fakeBrowser.history.onVisited, 'addListener');
  module.watchSiteChanges();
  let release!: (items: []) => void;
  vi.mocked(fakeBrowser.history.search).mockReturnValueOnce(new Promise(resolve => { release = resolve; }) as never);
  const old = module.ops.sites(host);
  listener.mock.calls[0][0](visit);
  release([]);
  await old;
  vi.mocked(fakeBrowser.history.search).mockResolvedValue([visit] as never);
  expect((await module.ops.sites(host)).map(s => s.domain)).toContain('github.com');
});

it('updates the cached open count when a tab is created', async () => {
  const listener = vi.spyOn(fakeBrowser.tabs.onCreated, 'addListener');
  module.watchSiteChanges();
  vi.mocked(fakeBrowser.history.search).mockResolvedValue([visit] as never);
  expect((await module.ops.sites(host))[0].openCount).toBe(0);
  const opened = { id: 2, windowId: 1, url: visit.url, title: 'Docs' };
  vi.mocked(fakeBrowser.tabs.query).mockResolvedValue([opened] as never);
  listener.mock.calls[0][0](opened as never);
  expect((await module.ops.sites(host))[0].openCount).toBe(1);
});
