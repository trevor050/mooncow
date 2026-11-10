// Chrome exposes the WebExtension API as `chrome` (promise-based in MV3);
// Firefox exposes `browser`. The codebase targets `browser`, so alias it.
if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
  globalThis.browser = globalThis.chrome;
}
