// Jina Page Summaries Tool
// Uses Jina Reader (https://r.jina.ai/<URL>) to fetch cleaned page text
// and returns a concise summary for each URL. Processes links sequentially
// and caches results for the session.

(function() {
  const NAME = "jina_page_summaries";

  // Session cache (persists while background stays alive)
  const cache = (self.__jinaCache = self.__jinaCache || new Map());

  // Utilities
  const DEFAULT_TIMEOUT = 8000;
  const SUMMARY_MAX_SENTENCES = 6;
  const SUMMARY_MAX_CHARS = 1200;

  const STOPWORDS = new Set([
    'the','and','a','an','of','to','in','for','on','at','by','from','as','that','this','these','those','is','are','was','were','be','been','being','with','it','its','or','if','but','about','into','through','over','after','before','between','down','up','out','off','than','then','so','such','can','could','should','would','may','might','will','just','also','not','no','yes','you','your','we','our','they','their','he','she','his','her','them','us'
  ]);

  // API key (storage first, fallback to hardcoded)
  const HARDCODED_JINA_API_KEY = 'jina_16d64a38654443bd8f6bae0056136a0a2jMsoYZ9JQWo1501eyIIK1SJLxs5';
  async function getJinaApiKey() {
    try {
      const stored = await (typeof browser !== 'undefined' && browser.storage?.local?.get
        ? browser.storage.local.get('JINA_API_KEY')
        : (typeof chrome !== 'undefined' && chrome.storage?.local?.get
          ? new Promise(res => chrome.storage.local.get('JINA_API_KEY', res))
          : Promise.resolve({})));
      const key = stored?.JINA_API_KEY || HARDCODED_JINA_API_KEY;
      return key;
    } catch (_) {
      return HARDCODED_JINA_API_KEY;
    }
  }

  function withTimeout(fn, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fn(controller.signal).finally(() => clearTimeout(timer));
  }

  async function fetchReaderText(url, timeoutMs = DEFAULT_TIMEOUT, apiKey = '') {
    try {
      let target = String(url || '').trim();
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
      if (cache.has(target)) return { ok: true, text: cache.get(target), cached: true };
      const headers = {
        'Content-Type': 'application/json',
        'X-Retain-Images': 'none',
        'X-With-Links-Summary': 'all'
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const body = JSON.stringify({ url: target });
      const resText = await withTimeout(
        (signal) => fetch('https://r.jina.ai/', { method: 'POST', headers, body, signal })
          .then(r => r.ok ? r.text() : null),
        timeoutMs
      );
      if (!resText) return { ok: false, error: 'fetch_failed' };
      cache.set(target, resText);
      return { ok: true, text: resText, cached: false };
    } catch (e) {
      return { ok: false, error: 'fetch_error:' + (e && e.name || 'unknown') };
    }
  }

  function normalizeMarkdown(md) {
    if (!md || typeof md !== 'string') return '';
    let t = md;
    // Drop code blocks and inline code (keep prose dominant)
    t = t.replace(/```[\s\S]*?```/g, '');
    t = t.replace(/`[^`]*`/g, '');
    // Remove excessive markdown syntax
    t = t.replace(/^#+\s+/gm, ''); // headings
    t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
    t = t.replace(/\*([^*]+)\*/g, '$1');
    t = t.replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1'); // links → URL/text
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  function splitSentences(text) {
    const parts = text
      .replace(/([\.!?])\s+(?=[A-Z0-9"\(\[])|([\.!?])(?!\s)/g, '$1\u0001')
      .split('\u0001')
      .map(s => s.trim())
      .filter(Boolean);
    return parts;
  }

  function scoreSentences(sentences) {
    const freq = new Map();
    for (const s of sentences) {
      for (const w of s.toLowerCase().match(/[a-z0-9]+/g) || []) {
        if (STOPWORDS.has(w)) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    return sentences.map((s, idx) => {
      let score = 0;
      for (const w of s.toLowerCase().match(/[a-z0-9]+/g) || []) {
        if (STOPWORDS.has(w)) continue;
        score += freq.get(w) || 0;
      }
      return { idx, s, score };
    });
  }

  function summarize(text) {
    const norm = normalizeMarkdown(text);
    if (!norm) return '';
    const sentences = splitSentences(norm).filter(s => s.length >= 40 && s.length <= 400);
    if (sentences.length === 0) {
      // Fallback: take first 2–3 paragraphs-ish
      return norm.slice(0, SUMMARY_MAX_CHARS);
    }
    const scored = scoreSentences(sentences);
    // Take top N by score but preserve original order
    const top = scored
      .sort((a,b) => b.score - a.score)
      .slice(0, SUMMARY_MAX_SENTENCES)
      .sort((a,b) => a.idx - b.idx)
      .map(x => x.s);
    let out = top.join(' ');
    if (out.length > SUMMARY_MAX_CHARS) out = out.slice(0, SUMMARY_MAX_CHARS) + '...';
    return out;
  }

  function extractTitle(md) {
    if (!md) return '';
    const m = md.match(/^\s*#\s+(.+?)\s*$/m) || md.match(/^\s*##\s+(.+?)\s*$/m);
    return m ? m[1].trim() : '';
  }

  self.JinaSummarizerTool = {
    name: NAME,
    description: "Fetches readable content via Jina Reader (r.jina.ai) and returns concise per-page summaries. Use after search to expand on specific links.",
    parameters: {
      type: "object",
      properties: {
        links: { type: "array", items: { type: "string", minLength: 5 }, minItems: 1, maxItems: 8, description: "HTTP(S) links to summarize (max 8)." },
      },
      required: ["links"]
    },
    async execute({ links }) {
      const apiKey = await getJinaApiKey().catch(() => '');
      const out = [];
      const seen = new Set();
      const now = new Date().toISOString();

      for (const raw of (links || [])) {
        if (!raw || typeof raw !== 'string') continue;
        if (out.length >= 8) break; // enforce cap strictly
        let url = raw.trim();
        try {
          if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
          // canonicalize basic trackers
          const u = new URL(url);
          ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(k => u.searchParams.delete(k));
          url = u.toString();
          if (seen.has(url)) continue; seen.add(url);
        } catch (_) { /* keep raw url if URL parsing fails */ }

        const fetched = await fetchReaderText(url, undefined, apiKey);
        if (!fetched.ok) {
          out.push({ url, status: 'error', error: fetched.error || 'unknown_error' });
          continue;
        }

        const md = fetched.text || '';
        const title = extractTitle(md);
        const summary = summarize(md);
        out.push({
          url,
          status: 'ok',
          title: title || null,
          summary,
          excerpt: (normalizeMarkdown(md).slice(0, 280) || ''),
          full_text: md,
          bytes: md.length,
          cached: !!fetched.cached,
          fetchedAt: now,
          via: 'r.jina.ai'
        });
      }

      return { summaries: out, meta: { tool: NAME, count: out.length } };
    }
  };

  // ---------------------------------------------
  // Jina combined tool: search + read (outline)
  // ---------------------------------------------
  async function jinaSearchOnce(query, apiKey, timeoutMs = DEFAULT_TIMEOUT) {
    const url = 'https://s.jina.ai/';
    try {
      const headers = { 'Content-Type': 'application/json' };
      // Jina search typically requires a Bearer key
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const res = await withTimeout((signal) => fetch(url, { method: 'POST', headers, body: JSON.stringify({ q: String(query || '').trim() }), signal }), timeoutMs);
      if (!res || !res.ok) {
        const txt = await (res && res.text ? res.text() : Promise.resolve('')).catch(() => '');
        return { ok: false, status: res && res.status, error: txt || 'search_failed' };
      }
      // Prefer JSON; fallback to text
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json().catch(() => null);
        if (!data) return { ok: false, status: res.status, error: 'invalid_json' };
        return { ok: true, status: res.status, data };
      }
      const text = await res.text().catch(() => '');
      return { ok: true, status: res.status, text };
    } catch (e) {
      return { ok: false, status: 0, error: 'search_error:' + (e && e.name || 'unknown') };
    }
  }

  self.JinaTool = {
    name: 'jina',
    description: "Jina tool: type='search' uses s.jina.ai; type='read' uses r.jina.ai to fetch readable text and summaries.",
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['search','read'], default: 'read', description: "Operation: 'search' or 'read'" },
        queries: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 10, description: "Search terms or URLs depending on type." },
        api_key: { type: 'string', description: 'Optional Jina API key (required for search). If omitted, tries stored or fallback.' },
        client_profile: { type: 'object', description: 'Optional, ignored. Included for compatibility.' }
      },
      required: ['queries']
    },
    async execute({ type = 'read', queries = [], api_key = '' }) {
      const op = (String(type || 'read').toLowerCase() === 'search') ? 'search' : 'read';
      console.log('[JinaTool] execute start', { op, qCount: Array.isArray(queries) ? queries.length : 0 });

      if (!Array.isArray(queries) || queries.length === 0) return { error: 'no_queries' };

      if (op === 'search') {
        const key = api_key || await getJinaApiKey().catch(() => '');
        if (!key) return { error: 'missing_api_key' };
        const results = [];
        for (const q of queries) {
          const r = await jinaSearchOnce(q, key);
          results.push({ query: q, ...r });
        }
        console.log('[JinaTool] search done', { count: results.length });
        return { mode: 'search', results, meta: { tool: 'jina', queries: queries.length } };
      }

      // read mode → summarize via Jina Reader
      const apiKey = api_key || await getJinaApiKey().catch(() => '');
      const out = [];
      for (const raw of queries) {
        if (!raw || typeof raw !== 'string') continue;
        const r = await fetchReaderText(raw, undefined, apiKey);
        if (!r.ok) { out.push({ url: raw, status: 'error', error: r.error || 'unknown_error' }); continue; }
        const md = r.text || '';
        const title = extractTitle(md);
        const summary = summarize(md);
        out.push({ url: raw, status: 'ok', title: title || null, summary, excerpt: (normalizeMarkdown(md).slice(0, 280) || ''), full_text: md, bytes: md.length, cached: !!r.cached, via: 'r.jina.ai' });
      }
      console.log('[JinaTool] read done', { count: out.length });
      return { mode: 'read', summaries: out, meta: { tool: 'jina', links: out.length } };
    }
  };

})();
