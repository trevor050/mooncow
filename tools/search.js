// Multi-source search tool: Wikipedia + DuckDuckGo; optionally adds News, Legal/Gov, Archives, etc.
// Enhanced with high-signal public sources (DoD/White House site-restricted feeds, Bing News, GDELT),
// smarter Federal Register filtering (agency + date windows), Wikipedia search fallback, and better IA filters.

// Utilities for parsing RSS/Atom safely into compact JSON
function parseRssAtom(xmlString, maxItems = 10) {
  try {
    if (!xmlString || typeof xmlString !== 'string') return [];
    const items = [];

    // Prefer DOMParser when available
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'application/xml');
      // Handle parsererror
      if (doc.querySelector('parsererror')) return [];

      const rssItems = Array.from(doc.querySelectorAll('channel > item'));
      const atomEntries = Array.from(doc.querySelectorAll('feed > entry'));

      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const getText = (node, sel) => clean(node.querySelector(sel)?.textContent || '');
      const getAttr = (node, sel, attr) => node.querySelector(sel)?.getAttribute(attr) || '';

      if (rssItems.length) {
        for (const it of rssItems.slice(0, maxItems)) {
          const title = getText(it, 'title');
          const link = getText(it, 'link');
          const pubDate = getText(it, 'pubDate');
          const source = getText(it, 'source');
          items.push({ title, link, published: pubDate || '', source: source || '' });
        }
      } else if (atomEntries.length) {
        for (const it of atomEntries.slice(0, maxItems)) {
          const title = getText(it, 'title');
          const linkEl = it.querySelector('link[rel="alternate"]') || it.querySelector('link');
          const link = linkEl?.getAttribute('href') || '';
          const published = getText(it, 'updated') || getText(it, 'published');
          const source = getText(it, 'source > title') || getText(it, 'author > name');
          items.push({ title, link, published, source });
        }
      }
      return items;
    }

    // Fallback: regex-based light parser when DOMParser is unavailable (e.g., MV3 worker)
    const out = [];
    const take = (arr) => arr ? arr.slice(0, maxItems) : [];

    const itemBlocks = take(xmlString.match(/<item[\s\S]*?<\/item>/gi));
    if (itemBlocks.length) {
      for (const block of itemBlocks) {
        const pick = (tag) => {
          const m = block.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, 'i'));
          return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        };
        out.push({
          title: pick('title'),
          link: pick('link'),
          published: pick('pubDate') || '',
          source: pick('source') || ''
        });
      }
      return out;
    }

    const entryBlocks = take(xmlString.match(/<entry[\s\S]*?<\/entry>/gi));
    for (const block of entryBlocks) {
      const pick = (tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, 'i'));
        return m ? m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
      };
      const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      out.push({
        title: pick('title'),
        link: linkMatch ? linkMatch[1] : '',
        published: pick('updated') || pick('published') || '',
        source: pick('source') || ''
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

self.MultiSourceSearchTool = {
  name: "multi_source_search",
  description:
    "Meta-search: Wikipedia + DuckDuckGo Instant Answer; if includeCoding=true, also Hacker News and Stack Overflow.",
  parameters: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 5 },
      // Back-compat: accept both includeCoding and codingRelated; prefer includeCoding
      includeCoding: { type: "boolean", default: false, description: "If true, include developer-heavy sources (HN, Stack Overflow)." },
      codingRelated: { type: "boolean", default: false, description: "Deprecated. Use includeCoding instead." },
      client_profile: { type: "object", description: "Client profile hints: meta + categories for downstream processing." },
      // Include flags per category
      includeNews_Current_Events: { type: "boolean", default: false },
      includeLegal_Gov: { type: "boolean", default: false },
      includeResearch_Scholarly: { type: "boolean", default: false },
      includeSocial_Dev: { type: "boolean", default: false },
      includeOpen_Data_Stats: { type: "boolean", default: false },
      includeArchives_Provenance: { type: "boolean", default: false },
      includeLocation_Geo: { type: "boolean", default: false }
    ,includeJinaSearch: { type: "boolean", default: false, description: "If true, run Jina Search (s.jina.ai) for extra discovery; disabled by default." }
    ,includeSearXNG: { type: "boolean", default: true, description: "Try public SearXNG instances for meta-search results; ignored on failure." }
    },
    required: ["queries"]
  },
  async execute({ queries, includeCoding=false, codingRelated=false, client_profile=null, includeNews_Current_Events=false, includeLegal_Gov=false, includeResearch_Scholarly=false, includeSocial_Dev=false, includeOpen_Data_Stats=false, includeArchives_Provenance=false, includeLocation_Geo=false, includeJinaSearch=false, includeSearXNG=true }) {
    // Normalize alias
    const coding = Boolean(includeCoding || codingRelated);
    const cache = new Map();
    const withTimeout = (fn, ms) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return fn(ctrl.signal).finally(() => clearTimeout(timer));
    };
    // Slightly longer default to reduce premature timeouts for RSS/HTML endpoints
    const DEFAULT_TIMEOUT = 7000; // lower default to reduce tail latency
    const PER_SOURCE = 8;
    const getJson = async (url, ms) => {
      if (cache.has(url)) return cache.get(url);
      const data = await withTimeout((signal) => fetch(url, { signal }).then(r => r.ok ? r.json() : null), ms ?? DEFAULT_TIMEOUT).catch(() => null);
      cache.set(url, data);
      return data;
    };
    const getText = async (url, ms) => {
      if (cache.has(url)) return cache.get(url);
      const data = await withTimeout((signal) => fetch(url, { signal }).then(r => r.ok ? r.text() : null), ms ?? DEFAULT_TIMEOUT).catch(() => null);
      cache.set(url, data);
      return data;
    };

    // Best-effort SearXNG provider: try a small list of public instances, short timeout, stop on first success
    const SEARXNG_INSTANCES = [
      // Stable first choice
      'https://searx.tiekoetter.com',
      // Backups (some may rate-limit; we fail gracefully)
      'https://searxng.site',
      'https://search.disroot.org',
      'https://searx.be',
      'https://search.projectsegfau.lt'
    ];
    const searxngSearch = async (query, ms, { categories = 'news,web', time_range = 'week' } = {}) => {
      const statuses = [];
      const buildParams = (fmt) => {
        const p = new URLSearchParams({ q: String(query||'').trim() });
        if (categories) p.set('categories', categories);
        if (time_range) p.set('time_range', time_range);
        if (fmt) p.set('format', fmt);
        return p.toString();
      };

      // Tiny CSV line parser (handles basic quoted cells)
      const parseCsv = (text, maxRows = 20) => {
        try {
          if (!text || typeof text !== 'string') return [];
          const lines = text.trim().split(/\r?\n/).filter(Boolean);
          if (!lines.length) return [];
          const split = (line) => {
            const out = [];
            let cur = '', q = false;
            for (let i = 0; i < line.length; i++) {
              const ch = line[i];
              if (ch === '"') {
                if (q && line[i+1] === '"') { cur += '"'; i++; }
                else { q = !q; }
              } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
              else { cur += ch; }
            }
            out.push(cur);
            return out.map(s => s.trim());
          };
          const header = split(lines.shift());
          const idxTitle = header.findIndex(h => /title/i.test(h));
          const idxUrl = header.findIndex(h => /^url$/i.test(h));
          const idxSnippet = header.findIndex(h => /(content|snippet|desc)/i.test(h));
          if (idxUrl === -1) return [];
          const rows = [];
          for (const line of lines.slice(0, maxRows)) {
            const cells = split(line);
            const title = (cells[idxTitle] || '').trim();
            const url = (cells[idxUrl] || '').trim();
            const snippet = (cells[idxSnippet] || '').replace(/\s+/g,' ').trim();
            if (url) rows.push({ title, url, content: snippet });
          }
          return rows;
        } catch (_) { return []; }
      };

      // Try CSV → RSS → JSON → HTML scraping with DOMParser/regex fallback
      for (const base of SEARXNG_INSTANCES) {
        // CSV (leanest if enabled)
        try {
          const url = `${base}/search?${buildParams('csv')}`;
          const csv = await withTimeout((signal) => fetch(url, { signal, headers: { 'Accept': 'text/csv' } }).then(r => r.ok ? r.text() : null), ms ?? 4500);
          if (csv && /url/i.test(csv.split(/\r?\n/)[0] || '')) {
            const rows = parseCsv(csv, 25);
            if (rows.length) return { ok: true, format: 'csv', instance: base, results: rows };
            statuses.push({ base, step: 'csv', status: 'empty' });
          } else { statuses.push({ base, step: 'csv', status: 'no_csv' }); }
        } catch (_) { statuses.push({ base, step: 'csv', status: 'error' }); }

        // RSS (text, more verbose, but common)
        try {
          const url = `${base}/search?${buildParams('rss')}`;
          const rss = await withTimeout((signal) => fetch(url, { signal, headers: { 'Accept': 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8' } }).then(r => r.ok ? r.text() : null), ms ?? 4500);
          const items = parseRssAtom(rss || '', 20);
          if (items && items.length) {
            const mapped = items.map(it => ({ title: it.title || '', url: it.link || '', content: '' })).filter(r => r.url);
            if (mapped.length) return { ok: true, format: 'rss', instance: base, results: mapped };
          }
          statuses.push({ base, step: 'rss', status: 'no_results' });
        } catch (_) { statuses.push({ base, step: 'rss', status: 'error' }); }

        // JSON attempt (nice-to-have)
        try {
          const url = `${base}/search?${buildParams('json')}`;
          const res = await withTimeout((signal) => fetch(url, { signal, headers: { 'Accept': 'application/json' } }), ms ?? 4500);
          if (res && res.ok) {
            const json = await res.json().catch(() => null);
            if (json && Array.isArray(json.results)) {
              return { ok: true, format: 'json', instance: base, results: json.results };
            }
            statuses.push({ base, step: 'json', status: 'bad_json' });
          } else {
            statuses.push({ base, step: 'json', status: res ? res.status : 0 });
          }
        } catch (_) {
          statuses.push({ base, step: 'json', status: 'error' });
        }

        // HTML fallback (robust, keyless)
        try {
          const url = `${base}/search?${buildParams()}`;
          const html = await withTimeout((signal) => fetch(url, { signal, credentials: 'omit' }).then(r => r.ok ? r.text() : null), ms ?? 5500);
          if (!html || typeof html !== 'string') { statuses.push({ base, step: 'html', status: 'no_html' }); continue; }
          let out = [];
          try {
            if (typeof DOMParser !== 'undefined') {
              const doc = new DOMParser().parseFromString(html, 'text/html');
              const items = Array.from(doc.querySelectorAll('#main_results .result, .result-list .result, .result')); // broad
              out = items.slice(0, 20).map(el => {
                const a = el.querySelector('a.result_header__link, .result_header a, .result a');
                const title = (a?.textContent || '').replace(/\s+/g,' ').trim();
                const url = a?.href || '';
                const sn = (el.querySelector('.content, .result-content, .result__snippet, .result-content .content')?.textContent || '')
                  .replace(/\s+/g,' ').trim();
                return { title, url, content: sn };
              }).filter(it => it.title && it.url);
            }
          } catch (_) { /* ignore DOM parse errors */ }
          if (!out.length) {
            // Regex light fallback
            try {
              const matches = html.match(/<a\s+[^>]*class=["'][^"']*result_header__link[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)
                || html.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*result_header[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)
                || [];
              out = matches.slice(0, 20).map(m => {
                const href = (m.match(/href=["']([^"']+)["']/i) || [,''])[1];
                const text = (m.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                return { title: text, url: href, content: '' };
              }).filter(it => it.title && it.url);
            } catch (_) { /* swallow */ }
          }
          if (out.length) {
            // Ensure plain text and compactness
            const clean = out.map(it => ({
              title: String(it.title||'').replace(/\s+/g,' ').trim(),
              url: it.url,
              content: String(it.content||'').replace(/\s+/g,' ').trim()
            }));
            return { ok: true, format: 'html', instance: base, results: clean };
          }
          statuses.push({ base, step: 'html', status: 'no_results' });
        } catch (_) {
          statuses.push({ base, step: 'html', status: 'error' });
        }
      }
      return { ok: false, attempts: statuses };
    };

    // Best-effort Jina Search wrapper (s.jina.ai). Requires API key; skip silently if missing.
    const HARDCODED_JINA_API_KEY = 'jina_16d64a38654443bd8f6bae0056136a0a2jMsoYZ9JQWo1501eyIIK1SJLxs5';
    const getJinaApiKey = async () => {
      try {
        const stored = await (typeof browser !== 'undefined' && browser.storage?.local?.get
          ? browser.storage.local.get('JINA_API_KEY')
          : (typeof chrome !== 'undefined' && chrome.storage?.local?.get
            ? new Promise(res => chrome.storage.local.get('JINA_API_KEY', res))
            : Promise.resolve({})));
        const key = stored?.JINA_API_KEY || HARDCODED_JINA_API_KEY || '';
        return key;
      } catch (_) { return HARDCODED_JINA_API_KEY || ''; }
    };
    const jinaSearch = async (query, ms) => {
      try {
        const key = await getJinaApiKey();
        const qs = new URLSearchParams({ q: String(query || '').trim() }).toString();
        const url = `https://s.jina.ai/?${qs}`;
        const headers = { 'Accept': 'text/plain' };
        if (key) headers['Authorization'] = `Bearer ${key}`;
        // Ask Jina to return plain text list
        headers['X-Respond-With'] = 'no-content';
        const res = await withTimeout((signal) => fetch(url, { method: 'GET', headers, signal }), ms ?? DEFAULT_TIMEOUT);
        if (!res || !res.ok) {
          const status = res ? res.status : 0;
          return { ok: false, status };
        }
        const text = await res.text().catch(() => '');
        return { ok: true, status: res.status, text };
      } catch (e) {
        return { ok: false, status: 0, error: 'jina_search_error' };
      }
    };

    // Heuristics for government/policy queries
    const lower = (s) => String(s || '').toLowerCase();
    const isGovPolicyQuery = (q) => /\b(dod|defense|pentagon|military|white\s*house|executive\s*order|federal\s*register|national\s*security|congress|senate|house|gao|crs|agency|policy|regulation)\b/i.test(q || '');

    // Build Federal Register URL with optional agency + date window filters
    const buildFederalRegisterUrls = (q) => {
      const urls = [];
      const base = 'https://www.federalregister.gov/api/v1/documents.json';
      const params = new URLSearchParams({ per_page: '50', 'conditions[order]': 'newest' });
      const ql = lower(q);
      const hasDoD = /(\bdod\b|\bdepartment of defense\b|\bdefense\b|\bpentagon\b)/i.test(ql);

      // Infer likely agencies from query
      const agencies = new Set();
      if (hasDoD) agencies.add('defense-department');
      if (/\barmy\b/.test(ql)) agencies.add('army-department');
      if (/\bnavy\b/.test(ql)) agencies.add('navy-department');
      if (/\bair\s*force\b/.test(ql) || /\bspace\s*force\b/.test(ql)) agencies.add('air-force-department');
      if (/\bspace\b/.test(ql) || /\bnasa\b/.test(ql)) agencies.add('national-aeronautics-and-space-administration');
      if (/\bhomeland\s*security\b|\bdhs\b/.test(ql)) agencies.add('homeland-security-department');
      if (/\bstate\b/.test(ql)) agencies.add('state-department');
      if (/\btreasury\b/.test(ql)) agencies.add('treasury-department');
      if (/\bjustice\b|\bdoj\b/.test(ql)) agencies.add('justice-department');
      if (/\benergy\b/.test(ql)) agencies.add('energy-department');
      if (/\bcommerce\b/.test(ql)) agencies.add('commerce-department');

      // Always include the raw term search as a baseline
      {
        const p = new URLSearchParams(params);
        if (q) p.set('conditions[term]', q);
        for (const a of agencies) p.append('conditions[agencies][]', a);
        urls.push(`${base}?${p.toString()}`);
      }

      // If DoD present, include an agency-targeted query without the raw term (to avoid over-restriction)
      if (agencies.size) {
        const p = new URLSearchParams(params);
        for (const a of agencies) p.append('conditions[agencies][]', a);
        urls.push(`${base}?${p.toString()}`);
      }
      // Generic recent windows: last 1 year and last 5 years
      const today = new Date();
      const daysAgo = (n) => new Date(Date.now() - n*24*60*60*1000);
      const fmt = (d) => d.toISOString().slice(0, 10);
      const windows = [
        [fmt(daysAgo(365)), fmt(today)],
        [fmt(daysAgo(5*365)), fmt(today)]
      ];
      for (const [gte, lte] of windows) {
        const p = new URLSearchParams(params);
        if (q) p.set('conditions[term]', q);
        p.set('conditions[publication_date][gte]', gte);
        p.set('conditions[publication_date][lte]', lte);
        for (const a of agencies) p.append('conditions[agencies][]', a);
        urls.push(`${base}?${p.toString()}`);
      }
      return Array.from(new Set(urls));
    };

    // Helper: Wikipedia search fallback to find a better matching title
    const wikiSearchBestTitle = async (q) => {
      try {
        const api = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=1&format=json&origin=*`);
        const title = api?.query?.search?.[0]?.title || '';
        return title;
      } catch (_) { return ''; }
    };

    const results = await Promise.all((queries || []).map(async (q) => {
      const sources = {};
      const STOP = new Set(['the','and','or','of','to','a','in','on','for','with','by','from','at','as','is','are','be','was','were','that','this','it','its','an','about','into','over','under','after','before','between','among']);
      const tokens = String(q||'').toLowerCase().split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t));
      const hasRelevantToken = (title) => {
        if (!title) return false;
        if (!tokens.length) return true;
        const t = String(title).toLowerCase();
        return tokens.some(tok => t.includes(tok));
      };

      // Core always (unconditional: Wikipedia summary + Wikidata quick facts) — fetch in parallel
      const sparql = encodeURIComponent(`SELECT ?item ?itemLabel WHERE { ?item rdfs:label "${q}"@en . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5`);
      const [wikiInit, wikidata] = await Promise.all([
        getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`),
        getJson(`https://query.wikidata.org/sparql?format=json&query=${sparql}`)
      ]);
      let wiki = wikiInit;
  // Fetch up to first 20k chars plaintext extract + related pages (best-effort)
  let wikiFull = null;
  let wikiBest = null;
  let wikiRelated = [];
      try {
        const needFallback = !wiki || String(wiki.type||'').includes('disambiguation') || !wiki.extract;
        let fullTitle = (wiki && wiki.title) ? wiki.title : q;
        if (needFallback) {
          const best = await wikiSearchBestTitle(q);
          if (best && best !== fullTitle) {
            const bestSum = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(best)}`);
            if (bestSum && !String(bestSum.type||'').includes('disambiguation')) {
              wikiBest = { title: bestSum.title, extract: bestSum.extract, url: bestSum.content_urls?.desktop?.page || '' };
              wiki = bestSum;
              fullTitle = bestSum.title || fullTitle;
            }
          }
        }
        const full = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=20000&titles=${encodeURIComponent(fullTitle)}&format=json&origin=*`);
        const pages = full?.query?.pages || {};
        const firstPage = Object.values(pages)[0];
        if (firstPage && typeof firstPage.extract === 'string' && firstPage.extract.trim()) {
          wikiFull = { title: firstPage.title || fullTitle, extract: firstPage.extract.trim() };
        }
        // Related articles: search for additional titles then fetch shorter extracts (5k chars)
        try {
          const searchRes = await getJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=6&format=json&origin=*`);
          const primaryTitle = (wikiFull?.title || wiki?.title || '').toLowerCase();
          const candidateTitles = (searchRes?.query?.search || [])
            .map(s => s.title)
            .filter(t => t && t.toLowerCase() !== primaryTitle)
            .slice(0,3);
          if (candidateTitles.length) {
            const titlesParam = candidateTitles.map(t => t.replace(/\|/g,' ')).join('|');
            const rel = await getJson(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=5000&titles=${encodeURIComponent(titlesParam)}&format=json&origin=*`);
            const relPages = rel?.query?.pages || {};
            wikiRelated = Object.values(relPages)
              .filter(p => p && typeof p.extract === 'string' && p.extract.trim())
              .map(p => ({ title: p.title, extract: p.extract.trim() }));
          }
        } catch (_) {}
      } catch (_) { /* ignore */ }
      // Lightweight always-on quick headlines (3) even without includeNews_Current_Events for immediate recency signal
      let quickNews = [];
      try {
        const quickXml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 4000);
        quickNews = parseRssAtom(quickXml, 3);
      } catch (_) {}
      sources.core_always = {
        wikipedia: wiki && !String(wiki.type||"").includes("disambiguation") ? { title: wiki.title, extract: wiki.extract, url: wiki.content_urls?.desktop?.page } : null,
        wikidata: wikidata?.results?.bindings?.map(b => ({ item: b.item?.value, label: b.itemLabel?.value })) || [],
        wikipedia_full: wikiFull,
        wikipedia_best_guess: wikiBest,
        wikipedia_related: wikiRelated,
        news_quick: quickNews
      };

      // General entity/context
      // Fetch DDG in parallel as it doesn't depend on wiki
      const ddg = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1`);
      sources.duckduckgo = ddg ? { heading: ddg.Heading || null, abstract: ddg.AbstractText || ddg.Abstract || null, url: ddg.AbstractURL || (ddg.Results?.[0]?.FirstURL ?? null) } : null;

      // Optional SearXNG meta-search: try public instances, ignore on failure
      if (includeSearXNG) {
        try {
          const sx = await searxngSearch(q, undefined, { categories: 'news,web', time_range: 'week' }).catch(() => null);
          if (sx && sx.ok && Array.isArray(sx.results)) {
            // Normalize and trim
            const mapped = sx.results
              .filter(it => it && (it.url || it.link) && hasRelevantToken(it.title))
              .slice(0, PER_SOURCE)
              .map(it => ({
                title: it.title || '',
                url: it.url || it.link || '',
                snippet: it.content || it.snippet || '',
                engines: it.engines || [],
                score: it.score
              }));
            sources.searxng = { instance: sx.instance, format: sx.format, results: mapped };
          } else if (sx && sx.attempts) {
            // Keep minimal telemetry without failing the tool
            sources.searxng_status = { ok: false, attempts: sx.attempts };
          }
        } catch (_) { /* ignore entirely */ }
      }

      // Optional Jina Search signal: only run when includeJinaSearch requested (best effort)
      if (includeJinaSearch) {
        try {
          const js = await jinaSearch(q).catch(() => null);
          if (js && (js.data || js.text || js.ok === false)) {
            sources.jina_search = js;
          }
        } catch (_) {}
      }

      // Coding-related quick sources
      if (coding) {
        const hn = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=${PER_SOURCE}`);
        const se = await getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=${PER_SOURCE}`);
        sources.hackernews = hn?.hits?.map(h => ({ title: h.title || h.story_title, url: h.url || h.story_url, points: h.points, author: h.author })) ?? [];
        sources.stackexchange = se?.items?.map(it => ({ title: it.title, link: it.link, is_answered: it.is_answered, score: it.score })) ?? [];
      }

      // News & current events (prepare as a task to run in parallel)
      const newsTask = includeNews_Current_Events ? (async () => {
        const buckets = {};
        const NEWS_TIMEOUT = 6000;
        const [googleNewsXml, reutersXml, guardianXml, apXml, cnnXml, bbcXml, foxXml, aljazeeraXml, politicoXml, theHillXml, defenseOneXml, breakingDefenseXml, militaryTimesXml, bingNewsXml, gdelt] = await Promise.all([
          getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, NEWS_TIMEOUT),
          getText(`https://www.reuters.com/rss/world`, NEWS_TIMEOUT),
          getText(`https://www.theguardian.com/world/rss`, NEWS_TIMEOUT),
          getText(`https://apnews.com/hub/ap-top-news?output=rss`, NEWS_TIMEOUT),
          // Additional mainstream feeds (best-effort, gracefully ignored if blocked)
          getText(`https://rss.cnn.com/rss/edition.rss`, NEWS_TIMEOUT),
          getText(`https://feeds.bbci.co.uk/news/world/rss.xml`, NEWS_TIMEOUT),
          getText(`https://feeds.foxnews.com/foxnews/latest`, NEWS_TIMEOUT),
          getText(`https://www.aljazeera.com/xml/rss/all.xml`, NEWS_TIMEOUT),
          getText(`https://rss.politico.com/politics-news.xml`, NEWS_TIMEOUT),
          getText(`https://thehill.com/feed/`, NEWS_TIMEOUT),
          getText(`https://www.defenseone.com/rss/all/`, NEWS_TIMEOUT),
          getText(`https://breakingdefense.com/feed/`, NEWS_TIMEOUT),
          getText(`https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml`, NEWS_TIMEOUT),
          getText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`, NEWS_TIMEOUT),
          // GDELT documents API (not always perfect, but free/public)
          getJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${PER_SOURCE}&format=json`, NEWS_TIMEOUT)
        ]);

        const dropDomains = new Set(['msn.com','yahoo.com','news.yahoo.com','finance.yahoo.com','aol.com','aol.co.uk','mediaite.com']);
        const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); } catch (_) { return ''; } };
        const decodeBingLink = (url) => {
          try {
            const u = new URL(url);
            if (u.hostname.includes('bing.com') && u.pathname.toLowerCase().includes('/news/apiclick')) {
              const real = u.searchParams.get('url');
              if (real) return decodeURIComponent(real);
            }
          } catch (_) {}
          return url;
        };
        const filt = (arr) => (Array.isArray(arr)
          ? arr
              .map(it => ({ ...it }))
              .filter(it => hasRelevantToken(it.title))
              .filter(it => !dropDomains.has(domainOf(it.link || '')))
              .slice(0, PER_SOURCE)
          : []);
        buckets.google_news = filt(parseRssAtom(googleNewsXml, PER_SOURCE * 2));
        buckets.bing_news = filt(parseRssAtom(bingNewsXml, PER_SOURCE * 3).map(it => ({ ...it, link: decodeBingLink(it.link) })));
        buckets.reuters = filt(parseRssAtom(reutersXml, PER_SOURCE * 2));
        buckets.guardian = filt(parseRssAtom(guardianXml, PER_SOURCE * 2));
        buckets.ap = filt(parseRssAtom(apXml, PER_SOURCE * 2));
        buckets.cnn = filt(parseRssAtom(cnnXml, PER_SOURCE * 2));
        buckets.bbc = filt(parseRssAtom(bbcXml, PER_SOURCE * 2));
        buckets.fox = filt(parseRssAtom(foxXml, PER_SOURCE * 2));
        buckets.aljazeera = filt(parseRssAtom(aljazeeraXml, PER_SOURCE * 2));
        buckets.politico = filt(parseRssAtom(politicoXml, PER_SOURCE * 2));
        buckets.thehill = filt(parseRssAtom(theHillXml, PER_SOURCE * 2));
        buckets.defenseone = filt(parseRssAtom(defenseOneXml, PER_SOURCE * 2));
        buckets.breakingdefense = filt(parseRssAtom(breakingDefenseXml, PER_SOURCE * 2));
        buckets.militarytimes = filt(parseRssAtom(militaryTimesXml, PER_SOURCE * 2));
        // GDELT filtering: keep only mainstream/official domains to reduce noise
        const trustedDomains = new Set([
          'reuters.com','apnews.com','ap.org','nytimes.com','washingtonpost.com','wsj.com','bloomberg.com','ft.com','bbc.com','bbc.co.uk','npr.org','economist.com',
          'politico.com','axios.com','defense.gov','army.mil','af.mil','navy.mil','marines.mil','spaceforce.mil','dhs.gov','state.gov','whitehouse.gov','congress.gov',
          'dod.mil','dni.gov','cia.gov','fbi.gov','justice.gov','treasury.gov','gao.gov','crsreports.congress.gov','everycrsreport.com','cbo.gov','gpo.gov','govinfo.gov',
          'dodig.mil','oig.justice.gov','oig.hhs.gov','oig.dhs.gov','oig.treasury.gov','oversight.house.gov','armed-services.senate.gov','armedservices.house.gov'
        ]);
        // domainOf already defined above in this block; reuse it for GDELT filtering
        buckets.gdelt = Array.isArray(gdelt?.articles)
          ? gdelt.articles
              .filter(a => trustedDomains.has(domainOf(a.url || '')))
              .slice(0, PER_SOURCE)
              .map(a => ({ title: a.title, link: a.url, published: a.seendate || '', source: a.sourceCountry || a.sourceCommonName || '' }))
          : [];

        // High-signal site-restricted Google News feeds for Gov/Defense queries (run in parallel with shorter timeout)
        if (isGovPolicyQuery(q)) {
          const S_GN_TIMEOUT = 5000;
          const gnSites = [
            ['google_news_defense_gov','defense.gov'],
            ['google_news_whitehouse','whitehouse.gov'],
            ['google_news_congress','congress.gov'],
            ['google_news_state_gov','state.gov'],
            ['google_news_treasury_gov','treasury.gov'],
            ['google_news_justice_gov','justice.gov'],
            ['google_news_dhs_gov','dhs.gov'],
            ['google_news_gao_gov','gao.gov'],
            ['google_news_crs_congress','crsreports.congress.gov'],
            ['google_news_everycrsreport','everycrsreport.com'],
            ['google_news_spaceforce_mil','spaceforce.mil'],
            ['google_news_navy_mil','navy.mil'],
            ['google_news_army_mil','army.mil'],
            ['google_news_af_mil','af.mil'],
            ['google_news_marines_mil','marines.mil'],
            ['google_news_defenseone','defenseone.com'],
            ['google_news_breakingdefense','breakingdefense.com'],
            ['google_news_militarytimes','militarytimes.com'],
            ['google_news_politico','politico.com'],
            ['google_news_thehill','thehill.com']
          ];
          const gnFetches = await Promise.all(gnSites.map(async ([key, site]) => {
            const xml = await getText(`https://news.google.com/rss/search?q=site:${encodeURIComponent(site)}%20${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, S_GN_TIMEOUT);
            return [key, filt(parseRssAtom(xml, PER_SOURCE * 2))];
          }));
          for (const [key, arr] of gnFetches) buckets[key] = arr;
        }

        // Build an aggressive merged top list across buckets, deduped by URL/title
        const merged = [];
        const seen = new Set();
        const addAll = (arr) => {
          for (const it of (arr || [])) {
            const key = (it.link || it.url || '') + '|' + (it.title || '').slice(0,80);
            if (!seen.has(key)) { seen.add(key); merged.push(it); }
          }
        };
        // Priority order: site-specific GN for gov queries, then mainstream feeds, then GN/Bing/GDELT
        const pushMaybe = (name) => { if (Array.isArray(buckets[name])) addAll(buckets[name]); };
        const siteGnNames = Object.keys(buckets).filter(k => k.startsWith('google_news_'));
        siteGnNames.forEach(pushMaybe);
        ['reuters','ap','guardian','cnn','bbc','fox','aljazeera','politico','thehill','defenseone','breakingdefense','militarytimes'].forEach(pushMaybe);
        ['google_news','bing_news'].forEach(pushMaybe);
        if (Array.isArray(buckets.gdelt)) addAll(buckets.gdelt);
        buckets.top_merged = merged.slice(0, PER_SOURCE * 3);

        return buckets;
      })() : Promise.resolve(null);

      // Legal / Gov (prepare as a task to run in parallel)
      const legalTask = includeLegal_Gov ? (async () => {
        const LEGAL_TIMEOUT = 6500;
        const courtlistenerP = getJson(`https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(q)}`, LEGAL_TIMEOUT);
        // Smarter Federal Register fetch: merge multiple filtered calls
        const frUrls = buildFederalRegisterUrls(q);
        const frPayloads = await Promise.all(frUrls.map(u => getJson(u, LEGAL_TIMEOUT)));
        // Merge FR results by document_number to avoid duplicates
        const frSeen = new Set();
        const frMerged = [];
        for (const payload of frPayloads) {
          const arr = Array.isArray(payload?.results) ? payload.results : [];
          for (const it of arr) {
            const key = it.document_number || it.id || it.html_url || JSON.stringify(it).slice(0,200);
            if (!frSeen.has(key)) { frSeen.add(key); frMerged.push(it); }
          }
        }
        // Defense.gov newsroom / releases + White House + Cabinet departments RSS (run in parallel)
        const [dodNewsXml, dodReleasesXml, whiteHouseRss, statePressRss, treasuryPressRss, dojPressRss, dhsPressRss, scotusRss, congressRss, secAtom, courtlistener] = await Promise.all([
          getText(`https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1`, LEGAL_TIMEOUT),
          getText(`https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=7`, LEGAL_TIMEOUT),
          getText(`https://www.whitehouse.gov/briefing-room/feed/`, LEGAL_TIMEOUT),
          getText(`https://www.state.gov/press-releases/feed/`, LEGAL_TIMEOUT),
          getText(`https://home.treasury.gov/news/press-releases/rss`, LEGAL_TIMEOUT),
          getText(`https://www.justice.gov/opa/rss/press-releases`, LEGAL_TIMEOUT),
          getText(`https://www.dhs.gov/news/feeds/rss.xml`, LEGAL_TIMEOUT),
          // White House: also use Google News site-restricted buckets as proxy (already in news if enabled)
          getText(`https://www.scotusblog.com/feed/`, LEGAL_TIMEOUT),
          getText(`https://www.congress.gov/rss/most-viewed`, LEGAL_TIMEOUT),
          getText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom`, LEGAL_TIMEOUT),
          courtlistenerP
        ]);
        return {
          courtlistener_api: courtlistener || null,
          federal_register_api: frMerged.length ? { results: frMerged } : null,
          scotusblog: parseRssAtom(scotusRss, PER_SOURCE),
          congress: parseRssAtom(congressRss, PER_SOURCE),
          sec_edgar: parseRssAtom(secAtom, PER_SOURCE),
          defense_gov_news: parseRssAtom(dodNewsXml, PER_SOURCE),
          defense_gov_releases: parseRssAtom(dodReleasesXml, PER_SOURCE),
          whitehouse: parseRssAtom(whiteHouseRss, PER_SOURCE),
          state_press: parseRssAtom(statePressRss, PER_SOURCE),
          treasury_press: parseRssAtom(treasuryPressRss, PER_SOURCE),
          justice_press: parseRssAtom(dojPressRss, PER_SOURCE),
          dhs_press: parseRssAtom(dhsPressRss, PER_SOURCE)
        };
      })() : Promise.resolve(null);

      // Research / Scholarly (prepare as a task to run in parallel)
      const researchTask = includeResearch_Scholarly ? (async () => {
        const RS_TIMEOUT = 6500;
        const [arxiv, pubmed, crossref, openalex, biorxiv] = await Promise.all([
          getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=25`, RS_TIMEOUT),
          getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(q)}`, RS_TIMEOUT),
          getJson(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=20`, RS_TIMEOUT),
          getJson(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=25`, RS_TIMEOUT),
          getText(`https://www.biorxiv.org/rss/latest`, RS_TIMEOUT)
        ]);
        return {
          arxiv: parseRssAtom(arxiv, PER_SOURCE),
          pubmed_api: pubmed || null,
          crossref_api: crossref || null,
          openalex_api: openalex || null,
          biorxiv: parseRssAtom(biorxiv, PER_SOURCE)
        };
      })() : Promise.resolve(null);

      // Social / Dev (prepare as a task to run in parallel)
      const socialTask = includeSocial_Dev ? (async () => {
        const SD_TIMEOUT = 6000;
        const [hn, reddit] = await Promise.all([
          getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story`, SD_TIMEOUT),
          getText(`https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}`, SD_TIMEOUT)
        ]);
        return { hn_algolia_api: hn || null, reddit: parseRssAtom(reddit, PER_SOURCE) };
      })() : Promise.resolve(null);

      // Archives / Provenance (prepare as a task to run in parallel)
      const archivesTask = includeArchives_Provenance ? (async () => {
        const AP_TIMEOUT = 6000;
        const looksUrl = /^(https?:\/\/)?[\w.-]+(\.[a-z]{2,})+(\/[^\s]*)?$/i.test(q);
        const iaQuery = isGovPolicyQuery(q)
          ? `(${q}) AND mediatype:(texts)`
          : `${q}`;
        const iaP = getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&output=json&rows=25`, AP_TIMEOUT);
        let waybackP = Promise.resolve(null), cdxP = Promise.resolve(null);
        if (looksUrl) {
          const url = q.startsWith('http') ? q : `https://${q}`;
          waybackP = getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, AP_TIMEOUT);
          cdxP = getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json`, AP_TIMEOUT);
        }
        const [iaSearch, waybackAvail, cdx] = await Promise.all([iaP, waybackP, cdxP]);
        return { wayback_availability_api: waybackAvail, wayback_cdx_api: cdx, ia_search_api: iaSearch };
      })() : Promise.resolve(null);

      // Location / Geo (prepare as a task to run in parallel)
      const locationTask = includeLocation_Geo
        ? getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1`)
        : Promise.resolve(null);

      // Await all category tasks together to minimize tail latency
      const [newsBuckets, legalGov, researchScholarly, socialDev, archivesProv, locGeo] = await Promise.all([
        newsTask, legalTask, researchTask, socialTask, archivesTask, locationTask
      ]);

      if (newsBuckets) sources.news_current_events = newsBuckets;
      if (legalGov) sources.legal_gov = legalGov;
      if (researchScholarly) sources.research_scholarly = researchScholarly;
      if (socialDev) sources.social_dev = socialDev;
      if (archivesProv) sources.archives_provenance = archivesProv;
      if (locGeo) sources.location_geo = { nominatim_api: locGeo || null };

      return { query: q, sources };
    }));

  return { results, meta: { includeCoding: coding, includeNews_Current_Events, includeLegal_Gov, includeResearch_Scholarly, includeSocial_Dev, includeOpen_Data_Stats, includeArchives_Provenance, includeLocation_Geo, includeJinaSearch, includeSearXNG, client_profile: client_profile || null } };
  }
};

// Support dynamic registration regardless of load order
try { if (typeof self.registerTool === 'function') self.registerTool(self.MultiSourceSearchTool); } catch (_) {}
