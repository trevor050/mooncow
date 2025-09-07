// Registry to expose tools in OpenAI/Cerebras function-calling format.
// Loaded in the background context before chat.js. Supports late registrations.

// Initialize registries if not present
if (!Array.isArray(self.toolRegistry)) self.toolRegistry = [];

// Best-effort helper: ensure known tools are registered even if load order was odd
function ensureKnownToolsRegistered() {
  try {
    if (!Array.isArray(self.toolRegistry)) self.toolRegistry = [];

    const have = new Set(self.toolRegistry.map(t => t && t.name).filter(Boolean));
    const toMaybeRegister = [];

    // Prefer globals if already defined by their scripts
    if (self.MultiSourceSearchTool && !have.has('multi_source_search')) toMaybeRegister.push(self.MultiSourceSearchTool);
    if (self.JinaTool && !have.has('jina')) toMaybeRegister.push(self.JinaTool);
    if (self.JinaSummarizerTool && !have.has('jina_page_summaries')) toMaybeRegister.push(self.JinaSummarizerTool);

    // As a last-resort in worker contexts, attempt to lazy-load scripts
    // Guard importScripts for service-worker/workers only
    if (typeof importScripts === 'function') {
      try {
        if (!self.MultiSourceSearchTool && !have.has('multi_source_search')) {
          importScripts('tools/search.js');
          if (self.MultiSourceSearchTool) toMaybeRegister.push(self.MultiSourceSearchTool);
        }
      } catch (_) { /* ignore */ }
      try {
        if (!self.JinaTool && !have.has('jina')) {
          // Try both tool folder and root fallback, depending on manifest wiring
          try { importScripts('tools/jina.js'); } catch (_) {}
          try { if (!self.JinaTool) importScripts('jina.js'); } catch (_) {}
          if (self.JinaTool) toMaybeRegister.push(self.JinaTool);
        }
      } catch (_) { /* ignore */ }
    }

    toMaybeRegister.filter(Boolean).forEach(t => {
      try { if (typeof self.registerTool === 'function') self.registerTool(t); } catch (_) {}
    });
  } catch (_) { /* no-op */ }
}

// Register function that tools can call even if this file loads earlier/later
self.registerTool = function registerTool(tool) {
  try {
    if (!tool || !tool.name || typeof tool.execute !== 'function') return;
    if (!Array.isArray(self.toolRegistry)) self.toolRegistry = [];
    const exists = self.toolRegistry.find(t => t && t.name === tool.name);
    if (!exists) {
      self.toolRegistry.push(tool);
      console.log('[ToolRegistry] Tool registered:', tool.name);
      // Refresh OpenAI-style descriptors
      self.openAITools = self.toolRegistry.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters }
      }));
      console.log('[ToolRegistry] openAITools:', self.openAITools.map(t => t.function?.name));
    }
  } catch (e) {
    console.warn('[ToolRegistry] registerTool failed:', e && e.message ? e.message : String(e));
  }
};

// Attempt to register any tools already attached to global
[ self.MultiSourceSearchTool, self.JinaSummarizerTool, self.JinaTool ].filter(Boolean).forEach(self.registerTool);

// Ensure openAITools exists even if no tools yet (prevents consumer errors)
if (!Array.isArray(self.openAITools)) self.openAITools = self.toolRegistry.map(t => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.parameters }
}));
console.log('[ToolRegistry] Startup tools:', self.toolRegistry.map(t => t?.name));

// Quick sanity self-test hook (optional): run from background console
self.__debugMultiSearch = async (queries = ["Donald Trump"]) => {
  const tool = (self.toolRegistry || []).find(t => t.name === 'multi_source_search');
  if (!tool) { console.warn('[ToolRegistry] multi_source_search not registered'); return; }
  console.log('[ToolRegistry] __debugMultiSearch running for queries:', queries);
  const res = await tool.execute({ queries, includeCoding: false, client_profile: buildClientProfile() });
  console.log('[ToolRegistry] __debugMultiSearch result:', res);
  return res;
};

// Debug runner for Jina tool
self.__debugJina = async ({ type = 'read', queries = [ 'https://jina.ai' ], api_key = '' } = {}) => {
  const tool = (self.toolRegistry || []).find(t => t.name === 'jina');
  if (!tool) { console.warn('[ToolRegistry] jina not registered'); return; }
  console.log('[ToolRegistry] __debugJina running:', { type, queries });
  const res = await tool.execute({ type, queries, api_key, client_profile: buildClientProfile() });
  console.log('[ToolRegistry] __debugJina result:', res);
  return res;
};

// Build a client profile payload to send with tool calls to look like a real client
function buildClientProfile() {
  return {
    meta: {
      version: '2025-09-06',
      strip_instructions_common: [
        'Always prefer publisher-provided <content:encoded> over <description> if present.',
        'If only summaries are present, fetch the <link> URL through Jina Reader (r.jina.ai/<link>) to get full text.',
        'Normalize whitespace, decode HTML entities, strip tags to plain text (keep basic <p><li><h*> for LLM context if you want).',
        'Remove boilerplate sections by regex: /(Related Articles|Most Read|Sign up|Cookie banner)/i.',
        'Canonicalize URLs (drop utm_* and tracking params), then build dedupe key: SHA1(host + pathname + normalized_title).'
      ],
      strip_instructions_api_common: [
        'APIs typically return JSON—select the documented text-bearing fields (title, abstract/summary, body) and join with newlines.',
        'If API returns only links, pass each link through Jina Reader to get article text.'
      ]
    },
    categories: {
      core_always: [
        {
          name: 'Jina Reader', id: 'jina_reader', run_by_default: true,
          type: 'api', api: { endpoint: 'https://r.jina.ai/https://<ANY_URL>', method: 'GET', params: null,
            returns: 'Markdown/plain text of target URL with main content extracted.', cors: 'Yes', rate_limit: 'Be polite; cache aggressively.', text_fields: ['full_text'] },
          notes: 'Universal text extractor. Use as the last step for any article link.'
        },
        {
          name: 'Wikipedia (REST Summary)', id: 'wikipedia_rest', run_by_default: true,
          type: 'api', api: { endpoint: 'https://en.wikipedia.org/api/rest_v1/page/summary/<TITLE>', method: 'GET', params: null,
            returns: 'JSON: title, description, extract (plain text summary).', cors: 'Yes', rate_limit: 'Polite limits; add `origin=*` if using action API.', text_fields: ['extract'] },
          notes: 'Fast entity card. For non-exact titles, hit /page/summary/<encoded query> after a search.'
        },
        {
          name: 'Wikidata SPARQL', id: 'wikidata_sparql', run_by_default: true,
          type: 'api', api: { endpoint: 'https://query.wikidata.org/sparql?format=json&query=<SPARQL>', method: 'GET', params: null,
            returns: 'JSON bindings; convert labels/values to fact lines.', cors: 'Yes', rate_limit: 'Polite; throttle; cache.', text_fields: ['bindings.* (assemble to prose)'] },
          notes: 'Great for quick facts (birthdates, positions, relationships).'
        }
      ],
      news_current_events: [
        {
          name: 'Google News (RSS)', id: 'google_news_rss', run_by_default: true,
          type: 'rss', rss: { endpoint: 'https://news.google.com/rss/search?q=<QUERY>&hl=en-US&gl=US&ceid=US:en',
            returns: 'RSS items with title, link, pubDate, source.',
            strip_to_text: [
              'Parse XML; for each <item>, collect <title>, <link>, <pubDate>, <source>.',
              'Fetch full text via Jina Reader using <link> to bypass partial summaries.',
              'Build dedupe_key from canonicalized <link> + normalized <title>.'
            ], dedupe_key: 'sha1(host+path+title)' },
          notes: 'Meta-aggregator; excellent for breadth and recency.'
        }
      ],
      social_dev: [
        {
          name: 'Hacker News (Algolia)', id: 'hn_algolia_api', run_by_default: false,
          type: 'api', api: { endpoint: 'https://hn.algolia.com/api/v1/search?query=<QUERY>&tags=story', method: 'GET', params: null,
            returns: 'JSON with titles, URLs, highlights.', cors: 'Yes', rate_limit: 'Friendly.', text_fields: ['title', 'story_text (if present)'],
            follow_up: 'Pass external URLs through Jina Reader.' }
        }
      ],
      archives_provenance: [
        {
          name: 'Wayback Availability', id: 'wayback_availability_api', run_by_default: false,
          type: 'api', api: { endpoint: 'https://archive.org/wayback/available?url=<URL>', method: 'GET', params: null,
            returns: 'JSON: closest snapshot URL.', cors: 'Yes', rate_limit: 'Friendly.', text_fields: ['archived_snapshots.closest.url'],
            follow_up: 'Fetch snapshot via Jina Reader to get historical page text.' }
        }
      ],
      location_geo: [
        {
          name: 'OpenStreetMap Nominatim', id: 'nominatim_api', run_by_default: false,
          type: 'api', api: { endpoint: 'https://nominatim.openstreetmap.org/search?q=<QUERY>&format=json&addressdetails=1', method: 'GET', params: null,
            returns: 'JSON geocoding results (names, lat/lon, address).', cors: 'Yes', rate_limit: 'STRICT. Set descriptive User-Agent. Cache heavily.', text_fields: ['display_name', 'type', 'lat/lon → \'Place: display_name (lat,lon)\''] },
          notes: 'Use sparingly; only when query obviously about places.'
        }
      ]
    }
  };
}

// Execute a tool call from the model
self.executeToolCall = async function({ name, arguments: argsJson }) {
  try { ensureKnownToolsRegistered(); } catch (_) {}
  console.log('[ToolRegistry] Executing tool:', name);
  let tool = (self.toolRegistry || []).find(t => t && t.name === name);
  // Fuzzy normalize and alias support
  if (!tool) {
    const n = String(name || '').trim().toLowerCase();
    const alias = n.replace(/[-\s]+/g, '_');
    tool = (self.toolRegistry || []).find(t => t && (t.name === alias || t.name === n));
  }
  // Last-chance: register known globals if they exist now
  if (!tool) {
    if (name === 'multi_source_search' && self.MultiSourceSearchTool) {
      try { self.registerTool(self.MultiSourceSearchTool); } catch (_) {}
      tool = (self.toolRegistry || []).find(t => t && t.name === 'multi_source_search');
    } else if ((name === 'jina' || name === 'jina_page_summaries') && (self.JinaTool || self.JinaSummarizerTool)) {
      try { if (self.JinaTool) self.registerTool(self.JinaTool); } catch (_) {}
      try { if (self.JinaSummarizerTool) self.registerTool(self.JinaSummarizerTool); } catch (_) {}
      tool = (self.toolRegistry || []).find(t => t && t.name === name);
    }
  }
  if (!tool) {
    const available = (self.toolRegistry || []).map(t => t && t.name).filter(Boolean);
    return { error: `Unknown tool: ${name}${available.length ? ' (available: ' + available.join(', ') + ')' : ''}` };
  }
  // Parse args whether provided as JSON string or object
  let args = {};
  try {
    if (typeof argsJson === 'string') {
      args = argsJson ? JSON.parse(argsJson) : {};
    } else if (argsJson && typeof argsJson === 'object') {
      args = argsJson;
    }
  } catch (_) {
    // leave args as {}
  }
  try {
    if (!args.client_profile) {
      args.client_profile = buildClientProfile();
      try {
        console.log('[ToolRegistry] Injected client_profile into args:', {
          version: args.client_profile?.meta?.version,
          sections: Object.keys(args.client_profile?.categories || {}).length
        });
      } catch (_) {}
    }
  } catch (e) { console.warn('[ToolRegistry] Failed to inject client_profile:', e); }
  try {
    const res = await tool.execute(args);
    return res;
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
