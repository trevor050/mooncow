// Multi-source search tool: Wikipedia + DuckDuckGo; if codingRelated=true, also HN and StackExchange
// Runs entirely client-side from the extension background context.

self.MultiSourceSearchTool = {
  name: "multi_source_search",
  description:
    "Meta-search: Wikipedia + DuckDuckGo Instant Answer; if codingRelated=true, also Hacker News and Stack Exchange.",
  parameters: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 10 },
      codingRelated: { type: "boolean", default: false },
      perSource: { type: "integer", minimum: 1, maximum: 20, default: 5 },
      region: { type: "string" },
      safe: { type: "string", enum: ["off","moderate","strict"], default: "moderate" },
      timeoutMs: { type: "integer", minimum: 500, maximum: 15000, default: 6000 }
    },
    required: ["queries"]
  },
  async execute({ queries, codingRelated=false, perSource=5, region, safe="moderate", timeoutMs=6000 }) {
    const cache = new Map();
    const withTimeout = (fn, ms) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms);
      return fn(ctrl.signal).finally(() => clearTimeout(timer));
    };
    const getJson = async (url, ms) => {
      if (cache.has(url)) return cache.get(url);
      const data = await withTimeout((signal) => fetch(url, { signal }).then(r => r.ok ? r.json() : null), ms).catch(() => null);
      cache.set(url, data);
      return data;
    };
    const kp = safe === "strict" ? 1 : (safe === "off" ? -1 : 0);

    const results = await Promise.all((queries || []).map(async (q) => {
      const wiki = await getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`, timeoutMs);
      const ddg  = await getJson(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1${region?`&kl=${encodeURIComponent(region)}`:""}&kp=${kp}`, timeoutMs);
      const hn   = codingRelated ? await getJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=${perSource}`, timeoutMs) : null;
      const se   = codingRelated ? await getJson(`https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(q)}&site=stackoverflow&pagesize=${perSource}`, timeoutMs) : null;

      const wikiOut = wiki && !String(wiki.type||"").includes("disambiguation")
        ? { title: wiki.title, extract: wiki.extract, url: wiki.content_urls?.desktop?.page }
        : null;
      const ddgOut  = ddg ? {
        heading: ddg.Heading || null,
        abstract: ddg.AbstractText || ddg.Abstract || null,
        url: ddg.AbstractURL || (ddg.Results?.[0]?.FirstURL ?? null)
      } : null;
      const hnOut = hn?.hits?.map(h => ({ title: h.title || h.story_title, url: h.url || h.story_url, points: h.points, author: h.author })) ?? [];
      const seOut = se?.items?.map(it => ({ title: it.title, link: it.link, is_answered: it.is_answered, score: it.score })) ?? [];

      return { query: q, sources: { wikipedia: wikiOut, duckduckgo: ddgOut, hackernews: hnOut, stackexchange: seOut } };
    }));

    if (codingRelated) {
      // light delay to be polite to public APIs when codingRelated fan-out is used
      await new Promise(r => setTimeout(r, 250));
    }

    return { results, meta: { perSource, codingRelated, region, safe } };
  }
};
