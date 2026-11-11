import '@/ui/styles.css';
import type { FrameMessage } from '@/lib/messages';
import { bootPalette } from '@/ui/app';
import type { HostTab } from '@/ui/env';

// Two surfaces share this page:
//  - overlay: an iframe the content script puts over the page
//  - window:  a small popup window, for pages where content scripts cannot run
const params = new URLSearchParams(location.search);
const surface = params.get('surface') === 'window' ? 'window' : 'overlay';
document.documentElement.classList.add(`surface-${surface}`);

async function resolveHost(): Promise<HostTab> {
  if (surface === 'window') {
    const tab = Number(params.get('tab'));
    const win = Number(params.get('window'));
    return { tabId: Number.isFinite(tab) && tab > 0 ? tab : null, windowId: Number.isFinite(win) && win > 0 ? win : null };
  }
  try {
    return (await browser.runtime.sendMessage({ type: 'whoami' })) as HostTab;
  } catch {
    return { tabId: null, windowId: null };
  }
}

const app = document.getElementById('app')!;
const scrim = document.createElement('div');
scrim.className = 'scrim';
app.appendChild(scrim);

const close = () => {
  if (surface === 'window') window.close();
  else window.parent.postMessage({ mooncow: 'close' } satisfies FrameMessage, '*');
};

// Clicking outside the panel closes it.
scrim.addEventListener('mousedown', (e) => {
  if (e.target === scrim) close();
});

void (async () => {
  const host = await resolveHost();
  const palette = await bootPalette({ surface, host, mount: scrim, close });
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if ((event.data as FrameMessage)?.mooncow === 'open') palette.show();
    if ((event.data as FrameMessage)?.mooncow === 'hide') palette.hide();
  });
  if (surface === 'window') window.addEventListener('blur', () => setTimeout(() => !document.hasFocus() && close(), 150));
  palette.show();
  window.parent.postMessage({ mooncow: 'ready' } satisfies FrameMessage, '*');
})();
