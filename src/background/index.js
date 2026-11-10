// Background entry point. Loaded as an event page in Firefox and as a module
// service worker in Chromium (see manifest.json). Import order matters: tools
// attach themselves to `self` before the registry collects them.
import '../shared/browser-shim.js';
import './tools/web-search.js';
import './tools/jina.js';
import './tool-registry.js';
import './cerebras-chat.js';
import './google-chat.js';
import './background.js';
import './streaming.js';
import './commands.js';
