(function() {
  const NAME = "openalex_search";

  const DEFAULT_TIMEOUT_MS = 8000;

  function withTimeout(fn, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fn(controller.signal).finally(() => clearTimeout(timer));
  }

  async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      const res = await withTimeout(
        (signal) => fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' }, signal }),
        timeoutMs
      );
      if (!res || !res.ok) {
        const status = res ? res.status : 0;
        let text = '';
        try { text = await (res && res.text ? res.text() : Promise.resolve('')); } catch (_) {}
        return { ok: false, status, error: text || 'request_failed' };
      }
      const data = await res.json().catch(() => null);
      return { ok: true, data };
    } catch (e) {
      return { ok: false, status: 0, error: 'network_error' };
    }
  }

  function simplifyAuthorship(authorships) {
    try {
      if (!Array.isArray(authorships)) return [];
      return authorships.map(a => ({
        author_id: a.author?.id || null,
        author_name: a.author?.display_name || null,
        institutions: Array.isArray(a.institutions) ? a.institutions.map(i => i.display_name).filter(Boolean) : []
      }));
    } catch (_) {
      return [];
    }
  }

  function simplifyWork(w) {
    return {
      id: w.id,
      doi: w.doi || null,
      title: w.display_name,
      publication_year: w.publication_year,
      primary_location: w.primary_location?.source?.display_name || null,
      host_venue: w.host_venue?.display_name || null,
      type: w.type,
      open_access: w.open_access?.is_oa || false,
      oa_url: w.open_access?.oa_url || null,
      cited_by_count: w.cited_by_count,
      authors: simplifyAuthorship(w.authorships)
    };
  }

  self.OpenAlexSearchTool = {
    name: NAME,
    description: "Search OpenAlex for scholarly works. No API key required. Returns titles, venues, authors, OA info, citations.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 2, description: 'Search string. Use quotes for exact phrases.' },
        filter: { type: 'string', description: 'Optional OpenAlex filter string (e.g., type:journal-article, from_publication_date:2020-01-01).'},
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
      },
      required: ['q']
    },
    async execute({ q, filter = '', limit = 10 }) {
      try {
        const query = String(q || '').trim();
        if (!query) return { error: 'empty_query' };
        const lim = Math.max(1, Math.min(50, Number(limit || 10)));
        const params = new URLSearchParams();
        params.set('search', query);
        params.set('per_page', String(lim));
        if (filter && String(filter).trim()) params.set('filter', String(filter).trim());
        const url = `https://api.openalex.org/works?${params.toString()}`;
        const res = await fetchJson(url);
        if (!res.ok) return { error: res.error || `http_${res.status || 0}` };
        const results = Array.isArray(res.data?.results) ? res.data.results.map(simplifyWork) : [];
        return { query, filter: filter || null, count: results.length, results };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    }
  };

  try { if (typeof self.registerTool === 'function') self.registerTool(self.OpenAlexSearchTool); } catch (_) {}
})();


