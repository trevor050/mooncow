# AGENTS.md

MoonCow: browser command bar (Firefox/Zen first, Chromium too). WXT + TypeScript, no UI framework. Thesis: the bar is the primary interface to the browser (tabs/history/commands) AND answers small utility tasks in place. Everything is a plugin on `src/core`.

## Commands
- Node >= 22.12 (jsdom 31 needs it). Locally `/opt/homebrew/bin/node` is 26; Homebrew `node@22` has a broken dylib, don't use it.
- `npm run build` (both), `build:chrome`, `build:firefox` → `.output/{chrome,firefox}-mv3`. `npm run zip` → store zips + Firefox sources zip.
- `npm test` (Vitest, TZ pinned to UTC in vitest.config). `npm run typecheck`. `npm run lint` (tsc + web-ext lint on firefox build).
- `npm run test:e2e`: Playwright loads `.output/chrome-mv3` (build first). `npm run test:firefox`: Puppeteer + WebDriver BiDi `installExtension` on `.output/firefox-mv3`; `FIREFOX_BIN` to point at Zen (`/Applications/Zen.app/Contents/MacOS/zen`).
- `npm run screenshots` regenerates `docs/screenshots/*` + `demo.gif` (needs ffmpeg). `npm run icons` renders `assets/icon.svg` → `public/icon/*.png`.

## Architecture
- `src/core`: `Tool`/`Result`/`Action`/`View` types, `Query` (precise matchers: command/is/prefixOf/suffix; no "contains" on purpose), `ranking.ts` (relevance×1000 + kind tiebreak + learned boost ≤40), `registry.ts` (sync results first, async merged, aborted signal = no stale publish), `fuzzy.ts`.
- `src/tools`: one file per built-in; `index.ts` registers. `dice.ts` is the documented example tool (README references it, keep in sync).
- `src/lib`: pure logic (calc parser, units, currency, color, hash, dates, markdown→DOM, OpenAI SSE client, settings) + `browser-ops.ts` (runs in background).
- `src/ui`: `palette.ts` (list, keys, action menu, views), `env.ts` (DataSource/Bridge = RPC to background), `app.ts` (boot for overlay/window/newtab), `views/*`.
- Entrypoints: `background.ts` (shortcut/action toggle, op relay, AI port, omnibox), `content.ts` (closed-shadow-root host + extension iframe overlay, page text), `palette/` (overlay + `?surface=window` popup fallback), `newtab/`, `options/`.

## Hazards (hard-won)
- Zen Window Sync exposes mirrors as separate tab IDs; deleting a mirror can delete the protected original. Detect `runtime.getBrowserInfo().zen` (name/UA still say Firefox). Bulk close pauses with multiple normal Zen windows; retain the snapshot checks in `browser-ops.ts`.
- Shared Windows testing: use `MOONCOW_E2E_PROFILE` for one Chromium process/profile per suite and `MOONCOW_FIREFOX_PROFILE` for smoke. Optional `MOONCOW_BROWSER_GATE` runs before each Windows launch; installed Chrome uses `MOONCOW_CHROMIUM_BIN` + CDP over Playwright's pipe.
- Firefox gives a moz-extension iframe inside a web page only the content-script API (no tabs/history/sessions/permissions). ALL browser access goes through `runtime.sendMessage({type:'op'})` → `lib/browser-ops.ts`. Chrome iframes have full API, so Chrome-only testing hides this.
- `permissions.request` is unavailable in the Firefox overlay frame and must be the first await in a click handler; AI setup in overlay redirects to options page.
- After the bar closes itself, focus must be pulled out of the hidden iframe (`frame.blur()` in content.ts) or the next keystrokes vanish.
- Firefox BiDi: frame.url() is stale (`about:blank`) for the iframe; navigation to moz-extension:// URLs is forbidden; `about:newtab` can't be opened by automation.
- Synthetic keys (Playwright/Puppeteer) never trigger browser `commands`, so tests go through the in-page Ctrl+E fallback; `activeTab` (screenshot) is only granted via the real command/toolbar button.
- nerdamer 2: solutions print as `{a, b}`; use `.evaluate().valueOf()` for decimals. Lazy-loaded (~536 KB chunk). Its `new Function` triggers a web-ext lint warning; never called.
- Chrome `sessions.lastModified` is seconds, Firefox ms.
- Lookup APIs (Wiktionary, Datamuse, Open-Meteo, Frankfurter, ipify) are CORS-open → no host permissions. Google Suggest is not → optional permission, suggestions default OFF. api.dictionaryapi.dev is behind a Cloudflare challenge; don't use it.
- Data collection manifest key requires Firefox 140 → `strict_min_version: 140.0`.

## Invariants
- A tool must stay silent on look-alike queries; add cases to `MUST_STAY_QUIET` in `test/tools.test.ts` when adding a tool.
- Tab-closing commands never exceed fallback relevance on single-word stubs (`clo`).
- AI question boost only when `aiConfigured()`; the API key never goes anywhere but the Authorization header to the user's endpoint.
- No innerHTML anywhere in UI; model output rendered via `lib/markdown.ts` DOM builder.
- No third-party favicon services (privacy); `{ site }` icons resolve locally.
