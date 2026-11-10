// Boots a palette in any surface: the overlay iframe, the popup-window
// fallback for pages extensions cannot touch, and the new tab page.
import { ToolRegistry } from '@/core/registry';
import type { PickStats } from '@/core/ranking';
import type { Settings } from '@/core/types';
import { PICKS_KEY } from '@/lib/messages';
import { loadSettings, mergeSettings } from '@/lib/settings';
import { BUILTIN_TOOLS } from '@/tools';
import { createEnvironment, type HostTab } from './env';
import { Palette } from './palette';

export type Surface = 'overlay' | 'window' | 'newtab';

export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Older engines or a lost user gesture: fall back to a hidden textarea.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export async function bootPalette(options: { surface: Surface; host: HostTab; mount: HTMLElement; close: () => void }): Promise<Palette> {
  let settings = await loadSettings();
  applyTheme(settings);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.settings) return;
    settings = mergeSettings(changes.settings.newValue as Partial<Settings>);
    applyTheme(settings);
  });

  const registry = new ToolRegistry().register(...BUILTIN_TOOLS);
  const env = createEnvironment(options.host, () => settings, { explicitHost: options.surface !== 'overlay' });
  const stats = ((await browser.storage.local.get(PICKS_KEY))[PICKS_KEY] as PickStats | undefined) || {};

  const palette = new Palette({
    registry,
    data: env.data,
    bridge: env.bridge,
    settings: () => settings,
    stats,
    saveStats: (s) => void browser.storage.local.set({ [PICKS_KEY]: s }),
    close: () => {
      env.invalidate();
      options.close();
    },
    copy: copyText,
    open: (url, newTab) => env.open(url, newTab),
  });
  palette.root.classList.add(`surface-${options.surface}`);
  options.mount.appendChild(palette.root);
  return palette;
}
