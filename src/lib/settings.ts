import type { Settings } from '@/core/types';

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  suggestions: false,
  newTabPage: true,
  ai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
    reasoningEffort: '',
  },
};

const KEY = 'settings';

export async function loadSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(KEY))[KEY] as Partial<Settings> | undefined;
  return mergeSettings(stored);
}

export function mergeSettings(stored: Partial<Settings> | undefined): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...(stored || {}),
    ai: { ...DEFAULT_SETTINGS.ai, ...((stored && stored.ai) || {}) },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settings });
}

/** Origin pattern for optional host permission, e.g. "https://api.openai.com/*". */
export function originPattern(baseUrl: string): string | null {
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** True when the AI tool has enough to make a request: hosted APIs need a key, local servers usually do not. */
export function aiConfigured(ai: Settings['ai']): boolean {
  return !!ai.baseUrl && !!ai.model && (!!ai.apiKey || !/api\.openai\.com|openrouter\.ai/.test(ai.baseUrl));
}
