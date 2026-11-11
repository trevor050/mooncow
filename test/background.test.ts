import background from '@/entrypoints/background';
import { fakeBrowser } from 'wxt/testing/fake-browser';

type Handler = (message: unknown, sender: unknown, reply: (value: unknown) => void) => unknown;
let handler: Handler;

beforeEach(() => {
  fakeBrowser.reset();
  const messages = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(() => {});
  for (const event of [fakeBrowser.history.onVisited, fakeBrowser.history.onVisitRemoved, fakeBrowser.tabs.onCreated, fakeBrowser.tabs.onRemoved, fakeBrowser.tabs.onUpdated, fakeBrowser.commands.onCommand, fakeBrowser.action.onClicked, fakeBrowser.runtime.onConnect, fakeBrowser.omnibox.onInputChanged, fakeBrowser.omnibox.onInputEntered]) {
    vi.spyOn(event, 'addListener').mockImplementation(() => {});
  }
  vi.spyOn(fakeBrowser.omnibox, 'setDefaultSuggestion').mockImplementation(() => {});
  background.main();
  handler = messages.mock.calls[0][0] as Handler;
});
afterEach(() => vi.restoreAllMocks());

it('keeps the channel open and replies through the callback on Chrome before 148', async () => {
  const reply = vi.fn();
  expect(handler({ type: 'whoami' }, { tab: { id: 12, windowId: 3 } }, reply)).toBe(true);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ tabId: 12, windowId: 3 }));
});

it('returns browser operation failures through the same callback', async () => {
  const reply = vi.fn();
  expect(handler({ type: 'op', op: 'missing', args: [] }, {}, reply)).toBe(true);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, error: 'Unknown operation missing' }));
});

it('does not claim messages it does not handle', () => {
  const reply = vi.fn();
  expect(handler({ type: 'unrelated' }, {}, reply)).toBeUndefined();
  expect(reply).not.toHaveBeenCalled();
});
