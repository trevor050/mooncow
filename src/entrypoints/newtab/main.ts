import '@/ui/styles.css';
import { loadSettings } from '@/lib/settings';
import { bootPalette } from '@/ui/app';

// The new tab page is the same bar at full size. The tab it lives in is the
// "current tab", so opening a result navigates this tab.
document.documentElement.classList.add('surface-newtab');

void (async () => {
  const settings = await loadSettings();
  const self = await browser.tabs.getCurrent();
  if (!settings.newTabPage) {
    // Turned off in MoonCow settings: hand the tab back to the browser's own page where allowed.
    const isFirefox = /Firefox\//.test(navigator.userAgent);
    if (self?.id && !isFirefox) {
      try {
        await browser.tabs.update(self.id, { url: 'chrome://new-tab-page/' });
        return;
      } catch {}
    }
  }
  const app = document.getElementById('app')!;
  const palette = await bootPalette({
    surface: 'newtab',
    host: { tabId: self?.id ?? null, windowId: self?.windowId ?? null },
    mount: app,
    close: () => palette.setQuery(''),
  });
  palette.show();
  // Browsers give a new tab's keyboard focus to the address bar. The bar takes
  // it as soon as the page is allowed to (first click or Tab), and on the shortcut.
  browser.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'mooncow:focus-newtab' && document.visibilityState === 'visible') palette.show();
  });
  window.addEventListener('focus', () => palette.show());
})();
