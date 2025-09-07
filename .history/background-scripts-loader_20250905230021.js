// Firefox fallback background script loader (MV3 service_worker modules not fully enabled)
// Dynamically import ES modules then expose required functions to global for legacy code paths.
(async () => {
  try {
    const searchMod = await import('./tools/search.js');
    const registryMod = await import('./tool-registry.js');
    const chatMod = await import('./chat.js');
    try { await import('./google-chat.js'); } catch (_) {}

    // Re-export needed functions on global for any legacy callers
    self.getCerebrasCompletion = chatMod.getCerebrasCompletion;
    self.streamCerebrasCompletion = chatMod.streamCerebrasCompletion;
    self.openAITools = registryMod.openAITools;
    self.executeToolCall = registryMod.executeToolCall;

    console.log('[FirefoxLoader] Modules loaded. Tools:', registryMod.openAITools.map(t=>t.function.name));
  } catch (e) {
    console.error('[FirefoxLoader] Failed to load modules', e);
  }
})();
