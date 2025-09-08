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

  // Best-effort resolver for aggregator/redirect URLs (e.g., news.google.com → publisher)
  const REDIRECTOR_HOSTS = new Set([
    'news.google.com', 't.co', 'lnkd.in', 'bit.ly', 'tinyurl.com', 'feedproxy.google.com', 'apple.news'
  ]);
  const resolveCache = (self.__redirectResolveCache = self.__redirectResolveCache || new Map());
  function isRedirector(url) {
    try { const h = new URL(String(url)).hostname.replace(/^www\./i, ''); return REDIRECTOR_HOSTS.has(h); } catch (_) { return false; }
  }
  async function resolveFinalUrl(startUrl, timeoutMs = 8000) {
    const key = 'R:' + String(startUrl || '');
    if (resolveCache.has(key)) return resolveCache.get(key);
    try {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'Mozilla/5.0 (X11; Linux x86_64)';
      const lang = (typeof navigator !== 'undefined' && navigator.language) ? navigator.language : 'en-US,en;q=0.9';
      const finalUrl = await withTimeout(async (signal) => {
        const r = await fetch(startUrl, { method: 'GET', redirect: 'follow', signal, headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'User-Agent': ua, 'Accept-Language': lang } });
        return (r && r.url) ? r.url : String(startUrl);
      }, timeoutMs);
      resolveCache.set(key, finalUrl);
      return finalUrl;
    } catch (_) {
      return String(startUrl);
    }
  }

  async function fetchReaderSingle(url, apiKey) {
    const res = await fetchReaderText(url, DEFAULT_TIMEOUT, apiKey);
    return res;
  }

  async function fetchReaderText(url, timeoutMs = DEFAULT_TIMEOUT, apiKey = '') {
    try {
      let target = String(url || '').trim();
      if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
      // Drop common tracking parameters
      try {
        const u = new URL(target);
        ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'].forEach(k => u.searchParams.delete(k));
        target = u.toString();
      } catch (_) { /* noop */ }
      if (cache.has(target)) return { ok: true, text: cache.get(target), cached: true };
      // Simple, reliable request: plain GET to r.jina.ai/<URL> (no SSE headers)
      const headers = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      const readerUrl = 'https://r.jina.ai/' + target;
      const resText = await withTimeout(
        (signal) => fetch(readerUrl, { method: 'GET', headers, signal })
          .then(r => r && r.ok ? r.text() : null),
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
    async execute({ type = 'read', queries = [], api_key = '', url, urls, link, links, query } = {}) {
      const op = (String(type || 'read').toLowerCase() === 'search') ? 'search' : 'read';
      console.log('[JinaTool] execute start', { op, qCount: Array.isArray(queries) ? queries.length : 0 });

      // Normalize inputs → queries[]
      let qList = [];
      if (Array.isArray(queries) && queries.length) qList = queries.slice(0, 10);
      else if (typeof queries === 'string' && queries.trim()) qList = [queries.trim()];
      else if (Array.isArray(urls) && urls.length) qList = urls.filter(x => typeof x === 'string' && x.trim()).slice(0, 10);
      else if (Array.isArray(links) && links.length) qList = links.filter(x => typeof x === 'string' && x.trim()).slice(0, 10);
      else if (typeof url === 'string' && url.trim()) qList = [url.trim()];
      else if (typeof link === 'string' && link.trim()) qList = [link.trim()];
      else if (typeof query === 'string' && query.trim()) qList = [query.trim()];

      if (!Array.isArray(qList) || qList.length === 0) return { error: 'no_queries' };

      if (op === 'search') {
        const key = api_key || await getJinaApiKey().catch(() => '');
        if (!key) return { error: 'missing_api_key' };
        const results = [];
        for (const q of qList) {
          const r = await jinaSearchOnce(q, key);
          results.push({ query: q, ...r });
        }
        console.log('[JinaTool] search done', { count: results.length });
        return { mode: 'search', results, meta: { tool: 'jina', queries: qList.length } };
      }

      // read mode → summarize via Jina Reader
      const apiKey = api_key || await getJinaApiKey().catch(() => '');
      const out = [];
      for (const raw of qList) {
        if (!raw || typeof raw !== 'string') continue;
        // Resolve known redirector URLs to the final publisher link first
        let target = raw;
        if (isRedirector(raw)) {
          try { target = await resolveFinalUrl(raw, 8000); } catch (_) { target = raw; }
        }
        const r = await fetchReaderSingle(target, apiKey);
        if (!r.ok) { out.push({ url: raw, status: 'error', error: r.error || 'unknown_error' }); continue; }
        const md = r.text || '';
        const title = extractTitle(md);
        const summary = summarize(md);
        out.push({ url: target, status: 'ok', title: title || null, summary, excerpt: (normalizeMarkdown(md).slice(0, 280) || ''), full_text: md, bytes: md.length, cached: !!r.cached, via: 'r.jina.ai' });
      }
      console.log('[JinaTool] read done', { count: out.length });
      return { mode: 'read', summaries: out, meta: { tool: 'jina', links: out.length } };
    }
  };

})();
