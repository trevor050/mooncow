import content from '@/entrypoints/content';
import { fakeBrowser } from 'wxt/testing/fake-browser';

it('can reopen immediately after an action closes the overlay', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  const messages = vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener');
  const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
  let frame: HTMLIFrameElement | undefined;
  const create = document.createElement.bind(document);
  const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const el = create(tag, options);
    if (tag === 'iframe') frame = el as HTMLIFrameElement;
    return el;
  }) as typeof document.createElement);
  try {
    await content.main({ onInvalidated() {} } as never);
    const reply = vi.fn();
    messages.mock.calls[0][0]({ type: 'mooncow:page-text' }, {}, reply);
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ text: expect.any(String), url: location.href }));
    const toggle = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true }));
    toggle();
    const host = document.querySelector<HTMLElement>('mooncow-palette')!;
    expect(host.style.display).toBe('block');
    vi.setSystemTime(10_010);
    toggle();
    expect(host.style.display).toBe('block'); // duplicate opening signal
    window.dispatchEvent(new MessageEvent('message', { source: frame!.contentWindow, data: { mooncow: 'close' } }));
    expect(host.style.display).toBe('none');
    vi.setSystemTime(10_100);
    toggle();
    expect(host.style.display).toBe('block');
    vi.setSystemTime(10_400);
    toggle();
    expect(host.style.display).toBe('none');
    vi.setSystemTime(10_410);
    toggle();
    expect(host.style.display).toBe('none'); // duplicate closing signal
  } finally {
    spy.mockRestore();
    focus.mockRestore();
    messages.mockRestore();
    vi.useRealTimers();
  }
});
