// Shared helpers for reading the active page from the background context.

export async function getActiveTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

// Ask the content script for the page's visible text. This works on every page
// the palette can open on and needs no host permissions, unlike
// scripting.executeScript.
export async function getPageText(tabId, maxChars = 8000) {
  if (typeof tabId !== 'number') {
    const tab = await getActiveTab();
    tabId = tab && tab.id;
  }
  if (typeof tabId !== 'number') return '';
  try {
    const res = await browser.tabs.sendMessage(tabId, { action: 'extractPageText' });
    return String((res && res.text) || '').slice(0, maxChars);
  } catch (_) {
    return '';
  }
}

// Environment details for system prompts. Service workers have no window or
// screen, so every field is optional.
export function describeEnvironment() {
  const g = globalThis;
  const nav = g.navigator || {};
  const scr = g.screen;
  return {
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: nav.userAgent || 'unknown',
    language: nav.language || (nav.languages && nav.languages[0]) || 'en-US',
    platform: nav.platform || 'unknown',
    screen: scr ? `${scr.width}x${scr.height}` : 'unknown',
    colorDepth: scr ? scr.colorDepth : 'unknown',
    pixelRatio: g.devicePixelRatio || 1,
  };
}
