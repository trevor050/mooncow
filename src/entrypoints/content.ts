// Hosts the palette over the page. The palette itself runs in an extension
// iframe, inside a closed shadow root, with every host style set inline and
// !important: page CSS cannot reach into the iframe and has nothing to grab
// on the host element.
import type { ContentRequest, FrameMessage, PageText } from '@/lib/messages';

const HOST_TAG = 'mooncow-palette';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main(ctx) {
    // A tab can receive this script twice (manifest + on-demand injection).
    const flag = '__mooncowContent';
    if ((window as unknown as Record<string, boolean>)[flag]) return;
    (window as unknown as Record<string, boolean>)[flag] = true;

    let host: HTMLElement | null = null;
    let frame: HTMLIFrameElement | null = null;
    let open = false;
    let lastToggle = 0;
    let previousFocus: Element | null = null;

    const hostStyle: Record<string, string> = {
      all: 'initial',
      position: 'fixed',
      inset: '0',
      width: '100vw',
      height: '100vh',
      'z-index': '2147483647',
      display: 'none',
      margin: '0',
      padding: '0',
      border: '0',
      background: 'transparent',
      'pointer-events': 'auto',
      'color-scheme': 'light dark',
    };

    function ensureFrame() {
      if (host && frame && host.isConnected) return;
      host = document.createElement(HOST_TAG);
      for (const [k, v] of Object.entries(hostStyle)) host.style.setProperty(k, v, 'important');
      const shadow = host.attachShadow({ mode: 'closed' });
      frame = document.createElement('iframe');
      frame.src = browser.runtime.getURL('/palette.html?surface=overlay' as '/palette.html');
      frame.title = 'MoonCow';
      frame.allow = 'clipboard-write';
      const frameStyle: Record<string, string> = {
        all: 'initial', display: 'block', width: '100%', height: '100%', border: '0', margin: '0',
        background: 'transparent', 'color-scheme': 'light dark',
      };
      for (const [k, v] of Object.entries(frameStyle)) frame.style.setProperty(k, v, 'important');
      shadow.appendChild(frame);
      document.documentElement.appendChild(host);
    }

    function show() {
      ensureFrame();
      previousFocus = document.activeElement;
      host!.style.setProperty('display', 'block', 'important');
      open = true;
      frame!.focus();
      frame!.contentWindow?.postMessage({ mooncow: 'open' } satisfies FrameMessage, '*');
    }

    function hide() {
      if (!host) return;
      host.style.setProperty('display', 'none', 'important');
      open = false;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
      else window.focus();
    }

    function toggle() {
      // The browser shortcut and the in-page fallback can both fire for one key press.
      const now = Date.now();
      if (now - lastToggle < 250) return;
      lastToggle = now;
      if (open) hide();
      else show();
    }

    window.addEventListener('message', (event) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as FrameMessage;
      if (data?.mooncow === 'close') hide();
      if (data?.mooncow === 'ready' && open) frame.contentWindow?.postMessage({ mooncow: 'open' } satisfies FrameMessage, '*');
    });

    // Fallback for when the browser shortcut is unassigned or taken: Ctrl/Cmd+E in the page.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          toggle();
        }
      },
      true,
    );

    browser.runtime.onMessage.addListener((message: ContentRequest) => {
      if (message?.type === 'mooncow:toggle') {
        toggle();
        return Promise.resolve(true);
      }
      if (message?.type === 'mooncow:page-text') {
        const text = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        const page: PageText = {
          url: location.href,
          title: document.title,
          text: text.slice(0, 12000),
          selection: String(window.getSelection() || '').slice(0, 4000),
        };
        return Promise.resolve(page);
      }
      return undefined;
    });

    ctx.onInvalidated(() => host?.remove());
  },
});
