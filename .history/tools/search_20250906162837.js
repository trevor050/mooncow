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
    },
    required: ["queries"]
  },
  async execute({ queries, includeCoding=false, codingRelated=false, client_profile=null, includeNews_Current_Events=false, includeLegal_Gov=false, includeResearch_Scholarly=false, includeSocial_Dev=false, includeOpen_Data_Stats=false, includeArchives_Provenance=false, includeLocation_Geo=false, includeJinaSearch=false }) {
    // Normalize alias
    const coding = Boolean(includeCoding || codingRelated);
    const cache = new Map();
    const withTimeout = (fn, ms) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return fn(ctrl.signal).finally(() => clearTimeout(timer));
    };
    // Slightly longer default to reduce premature timeouts for RSS/HTML endpoints
    const DEFAULT_TIMEOUT = 9000;
    const PER_SOURCE = 5;
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

      // Core always (unconditional: Wikipedia summary + Wikidata quick facts)
      let wiki = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`);
      const sparql = encodeURIComponent(`SELECT ?item ?itemLabel WHERE { ?item rdfs:label "${q}"@en . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } } LIMIT 5`);
      const wikidata = await getJson(`https://query.wikidata.org/sparql?format=json&query=${sparql}`);
      // Fetch up to first 20k chars plaintext extract of article (best-effort)
      let wikiFull = null;
      let wikiBest = null;
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
      } catch (_) { /* ignore */ }
      sources.core_always = {
        wikipedia: wiki && !String(wiki.type||"").includes("disambiguation") ? { title: wiki.title, extract: wiki.extract, url: wiki.content_urls?.desktop?.page } : null,
        wikidata: wikidata?.results?.bindings?.map(b => ({ item: b.item?.value, label: b.itemLabel?.value })) || [],
        wikipedia_full: wikiFull,
        wikipedia_best_guess: wikiBest
      };

      // General entity/context
      const ddg  = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1`);
      sources.duckduckgo = ddg ? { heading: ddg.Heading || null, abstract: ddg.AbstractText || ddg.Abstract || null, url: ddg.AbstractURL || (ddg.Results?.[0]?.FirstURL ?? null) } : null;

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

      // News & current events
      if (includeNews_Current_Events) {
        const buckets = {};
        const googleNewsXml = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 10000);
        const reutersXml = await getText(`https://www.reuters.com/rss/world`, 10000);
        const guardianXml = await getText(`https://www.theguardian.com/world/rss`, 10000);
        const apXml = await getText(`https://apnews.com/hub/ap-top-news?output=rss`, 10000);
        const bingNewsXml = await getText(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss`, 10000);
        // GDELT documents API (not always perfect, but free/public)
        const gdelt = await getJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${PER_SOURCE}&format=json`, 10000);

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
        // GDELT filtering: keep only mainstream/official domains to reduce noise
        const trustedDomains = new Set([
          'reuters.com','apnews.com','ap.org','nytimes.com','washingtonpost.com','wsj.com','bloomberg.com','ft.com','bbc.com','bbc.co.uk','npr.org','economist.com',
          'politico.com','axios.com','defense.gov','army.mil','af.mil','navy.mil','marines.mil','spaceforce.mil','dhs.gov','state.gov','whitehouse.gov','congress.gov',
          'dod.mil','dni.gov','cia.gov','fbi.gov','justice.gov','treasury.gov','gao.gov','crsreports.congress.gov','everycrsreport.com','cbo.gov','gpo.gov','govinfo.gov',
          'dodig.mil','oig.justice.gov','oig.hhs.gov','oig.dhs.gov','oig.treasury.gov','oversight.house.gov','armed-services.senate.gov','armedservices.house.gov'
        ]);
        const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); } catch (_) { return ''; } };
        buckets.gdelt = Array.isArray(gdelt?.articles)
          ? gdelt.articles
              .filter(a => trustedDomains.has(domainOf(a.url || '')))
              .slice(0, PER_SOURCE)
              .map(a => ({ title: a.title, link: a.url, published: a.seendate || '', source: a.sourceCountry || a.sourceCommonName || '' }))
          : [];

        // High-signal site-restricted Google News feeds for Gov queries
        if (isGovPolicyQuery(q)) {
          const gn = async (site) => {
            const xml = await getText(`https://news.google.com/rss/search?q=site:${encodeURIComponent(site)}%20${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, 10000);
            return filt(parseRssAtom(xml, PER_SOURCE * 2));
          };
          buckets.google_news_defense_gov = await gn('defense.gov');
          buckets.google_news_whitehouse = await gn('whitehouse.gov');
          buckets.google_news_congress = await gn('congress.gov');
          buckets.google_news_state_gov = await gn('state.gov');
          buckets.google_news_treasury_gov = await gn('treasury.gov');
          buckets.google_news_justice_gov = await gn('justice.gov');
          buckets.google_news_dhs_gov = await gn('dhs.gov');
          buckets.google_news_gao_gov = await gn('gao.gov');
          buckets.google_news_crs_congress = await gn('crsreports.congress.gov');
          buckets.google_news_everycrsreport = await gn('everycrsreport.com');
          buckets.google_news_spaceforce_mil = await gn('spaceforce.mil');
          buckets.google_news_navy_mil = await gn('navy.mil');
          buckets.google_news_army_mil = await gn('army.mil');
          buckets.google_news_af_mil = await gn('af.mil');
          buckets.google_news_marines_mil = await gn('marines.mil');
        }

        sources.news_current_events = buckets;
      }

      // Legal / Gov
      if (includeLegal_Gov) {
        const courtlistener = await getJson(`https://www.courtlistener.com/api/rest/v3/search/?q=${encodeURIComponent(q)}`);
        // Smarter Federal Register fetch: merge multiple filtered calls
        const frUrls = buildFederalRegisterUrls(q);
        const frPayloads = await Promise.all(frUrls.map(u => getJson(u)));
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
        // Defense.gov newsroom / releases RSS via public WAR.gov RSS mirror
        const dodNewsXml = await getText(`https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1`, 10000);
        const dodReleasesXml = await getText(`https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=7`, 10000);
        // White House: use Google News site-restricted buckets as proxy (already in news if enabled)
        const scotusRss = await getText(`https://www.scotusblog.com/feed/`);
        const congressRss = await getText(`https://www.congress.gov/rss/most-viewed`);
        const secAtom = await getText(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&output=atom`);
        sources.legal_gov = {
          courtlistener_api: courtlistener || null,
          federal_register_api: frMerged.length ? { results: frMerged } : null,
          scotusblog: parseRssAtom(scotusRss, PER_SOURCE),
          congress: parseRssAtom(congressRss, PER_SOURCE),
          sec_edgar: parseRssAtom(secAtom, PER_SOURCE),
          defense_gov_news: parseRssAtom(dodNewsXml, PER_SOURCE),
          defense_gov_releases: parseRssAtom(dodReleasesXml, PER_SOURCE)
        };
      }

      // Research / Scholarly
      if (includeResearch_Scholarly) {
        const arxiv = await getText(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&start=0&max_results=25`);
        const pubmed = await getJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(q)}`);
        const crossref = await getJson(`https://api.crossref.org/works?query=${encodeURIComponent(q)}&rows=20`);
        const openalex = await getJson(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per_page=25`);
        const biorxiv = await getText(`https://www.biorxiv.org/rss/latest`);
        sources.research_scholarly = {
          arxiv: parseRssAtom(arxiv, PER_SOURCE),
          pubmed_api: pubmed || null,
          crossref_api: crossref || null,
          openalex_api: openalex || null,
          biorxiv: parseRssAtom(biorxiv, PER_SOURCE)
        };
      }

      // Social / Dev
      if (includeSocial_Dev) {
        const hn = await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story`);
        const reddit = await getText(`https://www.reddit.com/search.rss?q=${encodeURIComponent(q)}`);
        sources.social_dev = { hn_algolia_api: hn || null, reddit: parseRssAtom(reddit, PER_SOURCE) };
      }

      // Archives / Provenance (only if query looks like a URL/domain)
      if (includeArchives_Provenance) {
        const looksUrl = /^(https?:\/\/)?[\w.-]+(\.[a-z]{2,})+(\/[^\s]*)?$/i.test(q);
        let waybackAvail = null, cdx = null;
        // Prefer gov/policy-relevant textual materials in Internet Archive advanced search
        const iaQuery = isGovPolicyQuery(q)
          ? `(${q}) AND mediatype:(texts)`
          : `${q}`;
        const iaSearch = await getJson(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&output=json&rows=25`);
        if (looksUrl) {
          const url = q.startsWith('http') ? q : `https://${q}`;
            // Wayback availability + CDX only meaningful for URL-like queries.
          waybackAvail = await getJson(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`);
          cdx = await getJson(`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json`);
        }
        sources.archives_provenance = { wayback_availability_api: waybackAvail, wayback_cdx_api: cdx, ia_search_api: iaSearch };
      }

      // Location / Geo
      if (includeLocation_Geo) {
        const nominatim = await getJson(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1`);
        sources.location_geo = { nominatim_api: nominatim || null };
      }

      return { query: q, sources };
    }));

  return { results, meta: { includeCoding: coding, includeNews_Current_Events, includeLegal_Gov, includeResearch_Scholarly, includeSocial_Dev, includeOpen_Data_Stats, includeArchives_Provenance, includeLocation_Geo, includeJinaSearch, client_profile: client_profile || null } };
  }
};

// Support dynamic registration regardless of load order
try { if (typeof self.registerTool === 'function') self.registerTool(self.MultiSourceSearchTool); } catch (_) {}
