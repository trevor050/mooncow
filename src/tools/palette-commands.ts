import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result, type ThemeSetting } from '@/core/types';
import { helpView } from '@/ui/views/help-view';
import { qrView } from '@/ui/views/qr-view';

// Commands about MoonCow itself: settings, theme, help, and QR codes for the
// current page or any text.

const THEMES: Record<string, ThemeSetting> = {
  'dark mode': 'dark', 'theme dark': 'dark', 'dark theme': 'dark',
  'light mode': 'light', 'theme light': 'light', 'light theme': 'light',
  'system theme': 'system', 'theme system': 'system', 'auto theme': 'system',
};

export default defineTool({
  id: 'palette',
  name: 'MoonCow',
  description: 'Settings, theme, this help list, and QR codes.',
  examples: ['?', 'settings', 'dark mode', 'qr', 'qr https://example.com'],
  match(q) {
    const results: Result[] = [];
    if (q.is('?', 'help', 'commands', 'what can you do')) {
      results.push({
        id: 'help',
        kind: 'command',
        title: 'What MoonCow can do',
        subtitle: 'Every tool, with examples you can run',
        icon: { glyph: 'sparkle' },
        relevance: RELEVANCE.explicit,
        actions: [{ title: 'Show tools', run: (ctx) => ctx.showView(helpView()) }],
      });
    }
    const settingsRelevance = q.is('settings', 'preferences', 'options', 'mooncow settings', 'api key')
      ? RELEVANCE.explicit
      : q.prefixOf(['settings', 'preferences', 'mooncow settings'], 4) ? RELEVANCE.partial + 0.15 : 0;
    if (settingsRelevance) {
      results.push({
        id: 'settings',
        kind: 'command',
        title: 'MoonCow settings',
        subtitle: 'AI provider, theme, suggestions',
        icon: { glyph: 'gear' },
        relevance: settingsRelevance,
        actions: [{ title: 'Open settings', run: async (ctx) => { await ctx.browser.openOptions(); ctx.close(); } }],
      });
    }
    const theme = THEMES[q.lower];
    if (theme) {
      results.push({
        id: `theme:${theme}`,
        kind: 'command',
        title: `Use ${theme} theme`,
        icon: { glyph: 'color' },
        relevance: RELEVANCE.explicit,
        actions: [{ title: 'Apply', run: (ctx) => ctx.browser.setTheme(theme) }],
      });
    }
    const qr = q.command('qr', 'qr code', 'qrcode');
    if (qr !== null) {
      results.push({
        id: 'qr',
        kind: 'command',
        title: qr ? `QR code for “${qr.length > 48 ? qr.slice(0, 48) + '…' : qr}”` : 'QR code for this page',
        subtitle: 'Generated on your device',
        icon: { glyph: 'qr' },
        relevance: RELEVANCE.explicit,
        actions: [{ title: 'Show QR code', run: (ctx) => ctx.showView(qrView(qr || null)) }],
      });
    }
    return results;
  },
});
