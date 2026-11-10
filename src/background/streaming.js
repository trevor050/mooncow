// AI streaming over a long-lived port. The panel opens a port named "ai-stream"
// per request; tokens flow back over that port. Closing the panel (or pressing
// stop) disconnects the port, which stops pulling from the model generator.
import { streamCerebrasCompletion } from './cerebras-chat.js';
import { streamGoogleCompletion } from './google-chat.js';

const PROVIDERS = {
  streamCerebrasCompletion,
  streamGoogleCompletion,
};

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-stream') return;
  let cancelled = false;
  port.onDisconnect.addListener(() => { cancelled = true; });

  port.onMessage.addListener(async (message) => {
    const stream = PROVIDERS[message && message.action];
    const streamId = message && message.streamId;
    const send = (payload) => {
      if (cancelled) return;
      try { port.postMessage({ streamId, ...payload }); } catch (_) { cancelled = true; }
    };
    if (!stream) {
      send({ error: `Unknown stream action: ${message && message.action}` });
      return;
    }
    try {
      for await (const token of stream(message.messages || [], message.options || {})) {
        if (cancelled) break;
        send({ token });
      }
      send({ done: true });
    } catch (err) {
      send({ error: (err && err.message) || 'stream error' });
    }
  });
});
