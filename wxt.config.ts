import { defineConfig } from 'wxt';

// One source of truth for both browsers. WXT turns this into a Manifest V3
// package per target: a service worker background for Chromium and an event
// page for Firefox, with browser-specific keys dropped where they do not apply.
//
// Every permission is explained in README.md ("Permissions").
export default defineConfig({
  srcDir: 'src',
  outDir: '.output',
  manifestVersion: 3,
  // The Firefox sources zip is for AMO reviewers: code and build config only.
  zip: { excludeSources: ['docs/**', '.github/**', '.shots/**', 'test-results/**', 'playwright-report/**'] },
  manifest: ({ browser }) => ({
    name: 'MoonCow',
    description: 'The command bar as the way you use your browser: tabs, history, commands and instant answers, all from one keystroke.',
    permissions: [
      'tabs',
      'history',
      'bookmarks',
      'sessions',
      'storage',
      'scripting',
      'activeTab',
      'clipboardWrite',
      // Chromium's local favicon cache; Firefox has no equivalent API.
      ...(browser === 'firefox' ? [] : ['favicon']),
    ],
    // No host permissions by default. The public lookup APIs MoonCow uses send
    // CORS headers, so they need none. These two are requested at runtime for
    // one origin each: Google Suggest when you turn suggestions on, and the AI
    // endpoint you configure.
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'Open MoonCow' },
    commands: {
      'toggle-palette': {
        suggested_key: { default: 'Ctrl+E', mac: 'Command+E' },
        description: 'Open or close the MoonCow bar',
      },
    },
    omnibox: { keyword: 'mc' },
    web_accessible_resources: [{ resources: ['palette.html'], matches: ['<all_urls>'] }],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'mooncow-search@mooncow.dev',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'], optional: ['searchTerms', 'websiteContent'] },
            },
            gecko_android: {
              strict_min_version: '142.0',
            },
          },
        }
      : {}),
  }),
});
