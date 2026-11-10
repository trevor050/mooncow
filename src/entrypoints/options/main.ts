import '@/ui/styles.css';
import type { Settings } from '@/core/types';
import { CHAT_KEY, PICKS_KEY } from '@/lib/messages';
import { streamChat } from '@/lib/openai';
import { loadSettings, originPattern, saveSettings } from '@/lib/settings';
import { applyTheme } from '@/ui/app';
import { h } from '@/ui/dom';
import { AI_PRESETS, requestAiOrigin } from '@/ui/views/chat-view';

const isFirefox = /Firefox\//.test(navigator.userAgent);

void (async () => {
  let settings = await loadSettings();
  applyTheme(settings);
  const app = document.getElementById('app')!;
  const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const say = (msg: string, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };
  const save = async (patch: Partial<Settings>) => {
    settings = { ...settings, ...patch, ai: { ...settings.ai, ...(patch.ai || {}) } };
    await saveSettings(settings);
    applyTheme(settings);
  };

  // ---------------------------------------------------------------- AI
  const base = h('input', { class: 'field', type: 'url', value: settings.ai.baseUrl, spellcheck: 'false', id: 'base' });
  const key = h('input', { class: 'field', type: 'password', value: settings.ai.apiKey, autocomplete: 'off', id: 'key', placeholder: 'Not needed for most local servers' });
  const model = h('input', { class: 'field', type: 'text', value: settings.ai.model, spellcheck: 'false', id: 'model' });
  const effort = h('select', { class: 'field', id: 'effort' },
    ...[['', 'Model default (send nothing)'], ['none', 'none'], ['low', 'low'], ['medium', 'medium'], ['high', 'high']].map(([v, l]) => {
      const o = h('option', { value: v }, l);
      if (v === settings.ai.reasoningEffort) o.selected = true;
      return o;
    }),
  );
  const presets = h('div', { class: 'presets' });
  for (const p of AI_PRESETS) {
    const b = h('button', { class: 'chip', type: 'button' }, p.label);
    b.addEventListener('click', () => { base.value = p.baseUrl; model.value = p.model; });
    presets.append(b);
  }
  const reveal = h('button', { class: 'ghost small', type: 'button' }, 'Show');
  reveal.addEventListener('click', () => { key.type = key.type === 'password' ? 'text' : 'password'; reveal.textContent = key.type === 'password' ? 'Show' : 'Hide'; });
  const saveAi = h('button', { class: 'primary', type: 'button' }, 'Save');
  const test = h('button', { class: 'ghost', type: 'button' }, 'Test connection');

  saveAi.addEventListener('click', () => {
    const pending = requestAiOrigin(base.value); // must start inside the click
    void pending.then(async (ok) => {
      if (!ok) return say(`MoonCow needs permission to reach ${originPattern(base.value) || 'that address'}.`, true);
      await save({ ai: { baseUrl: base.value.trim(), apiKey: key.value.trim(), model: model.value.trim(), reasoningEffort: effort.value as Settings['ai']['reasoningEffort'] } });
      say('Saved.');
    });
  });
  test.addEventListener('click', async () => {
    say('Testing…');
    try {
      let reply = '';
      const ai = { baseUrl: base.value.trim(), apiKey: key.value.trim(), model: model.value.trim(), reasoningEffort: effort.value as Settings['ai']['reasoningEffort'] };
      for await (const ev of streamChat(ai, [{ role: 'user', content: 'Reply with the single word: ready' }], AbortSignal.timeout(30000))) {
        if (ev.type === 'delta') reply += ev.text;
      }
      say(`Connected. ${model.value} replied: “${reply.trim().slice(0, 60)}”`);
    } catch (err) {
      say((err as Error).message, true);
    }
  });

  // ------------------------------------------------------------ general
  const theme = h('select', { class: 'field', id: 'theme' },
    ...(['system', 'light', 'dark'] as const).map((t) => {
      const o = h('option', { value: t }, t[0].toUpperCase() + t.slice(1));
      if (t === settings.theme) o.selected = true;
      return o;
    }),
  );
  theme.addEventListener('change', () => void save({ theme: theme.value as Settings['theme'] }));

  const suggestions = h('input', { type: 'checkbox', id: 'suggestions' });
  suggestions.checked = settings.suggestions;
  suggestions.addEventListener('change', () => void save({ suggestions: suggestions.checked }));

  const newtab = h('input', { type: 'checkbox', id: 'newtab' });
  newtab.checked = settings.newTabPage;
  newtab.addEventListener('change', () => void save({ newTabPage: newtab.checked }));

  const forget = h('button', { class: 'ghost', type: 'button' }, 'Forget learned ranking and chat');
  forget.addEventListener('click', async () => {
    await browser.storage.local.remove([PICKS_KEY, CHAT_KEY]);
    say('Cleared what MoonCow learned and the saved chat.');
  });

  const shortcuts = h('button', { class: 'ghost', type: 'button' }, 'Change keyboard shortcut');
  shortcuts.addEventListener('click', () => {
    if (isFirefox) void browser.tabs.create({ url: 'about:addons' });
    else void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  app.append(
    h('header', { class: 'opt-head' }, h('h1', {}, 'MoonCow'), h('p', { class: 'muted' }, 'Everything you do in the bar stays in this browser, except what is listed under Privacy.')),
    h('section', { class: 'opt' },
      h('h2', {}, 'AI'),
      h('p', { class: 'muted' }, 'Any OpenAI-compatible chat completions endpoint: OpenAI, OpenRouter, or a local server such as Ollama or LM Studio.'),
      presets,
      h('label', { for: 'base' }, 'Base URL'), base,
      h('label', { for: 'key' }, 'API key'), h('div', { class: 'row-inline' }, key, reveal),
      h('label', { for: 'model' }, 'Model'), model,
      h('label', { for: 'effort' }, 'Reasoning effort'), effort,
      h('div', { class: 'row-inline' }, saveAi, test),
      status,
    ),
    h('section', { class: 'opt' },
      h('h2', {}, 'Bar'),
      h('label', { for: 'theme' }, 'Theme'), theme,
      h('label', { class: 'check' }, suggestions, ' Search suggestions from Google as you type'),
      h('p', { class: 'fine' }, 'Off by default. When on, what you type in the bar (after two characters) is sent to Google to fetch suggestions. Your own past searches are suggested locally either way.'),
      h('label', { class: 'check' }, newtab, ' Use MoonCow as the new tab page'),
      h('p', { class: 'fine' }, isFirefox
        ? 'Firefox decides this in Settings → Home → New tabs. Pick “MoonCow” or “Firefox Home” there.'
        : 'When off, new tabs hand off to Chrome’s own page.'),
      h('div', { class: 'row-inline' }, shortcuts, forget),
    ),
    h('section', { class: 'opt' },
      h('h2', {}, 'Privacy'),
      h('ul', { class: 'plain' },
        h('li', {}, 'AI questions, and page text when you include it, go to the AI endpoint above. Your key is stored in this browser profile only.'),
        h('li', {}, 'Explicit lookups go to keyless public APIs when you type them: definitions (Wiktionary, Datamuse), weather and city times (Open-Meteo), exchange rates (Frankfurter), “my ip” (ipify).'),
        h('li', {}, 'Search suggestions go to Google only if you turn them on above.'),
        h('li', {}, 'Tabs, history, bookmarks, what you pick, hashes, colors, dates, JSON and JWT decoding never leave the browser.'),
      ),
    ),
  );
})();
