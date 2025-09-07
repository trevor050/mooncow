(function() {
  const NAME = "github_search";

  const DEFAULT_TIMEOUT_MS = 7000;

  function withTimeout(fn, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fn(controller.signal)
      .finally(() => clearTimeout(timer));
  }

  async function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
    try {
      const res = await withTimeout(
        (signal) => fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/vnd.github+json'
          },
          signal
        }),
        timeoutMs
      );
      if (!res || !res.ok) {
        const status = res ? res.status : 0;
        let text = '';
        try { text = await (res && res.text ? res.text() : Promise.resolve('')); } catch (_) {}
        return { ok: false, status, error: text || 'request_failed', headers: {} };
      }
      let data = null;
      try { data = await res.json(); } catch (_) { data = null; }
      const headers = {
        rate_limit: res.headers.get('x-ratelimit-limit'),
        rate_remaining: res.headers.get('x-ratelimit-remaining'),
        rate_reset: res.headers.get('x-ratelimit-reset')
      };
      return { ok: true, data, headers };
    } catch (e) {
      return { ok: false, status: 0, error: 'network_error' };
    }
  }

  function simplifyRepo(item) {
    return {
      id: item.id,
      name: item.name,
      full_name: item.full_name,
      html_url: item.html_url,
      description: item.description,
      language: item.language,
      stargazers_count: item.stargazers_count,
      forks_count: item.forks_count,
      open_issues_count: item.open_issues_count,
      license: item.license ? item.license.spdx_id || item.license.name : null,
      topics: Array.isArray(item.topics) ? item.topics : [],
      updated_at: item.updated_at,
      owner: item.owner ? { login: item.owner.login, html_url: item.owner.html_url } : null
    };
  }

  function simplifyIssue(item) {
    return {
      id: item.id,
      title: item.title,
      html_url: item.html_url,
      state: item.state,
      comments: item.comments,
      created_at: item.created_at,
      updated_at: item.updated_at,
      user: item.user ? { login: item.user.login, html_url: item.user.html_url } : null,
      repository_url: item.repository_url,
      pull_request: !!item.pull_request
    };
  }

  self.GitHubSearchTool = {
    name: NAME,
    description: "Search GitHub repositories or issues without auth (60 req/hr/IP). Use for discovering libraries, starters, examples, or related issues.",
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 2, description: 'Search query. Use qualifiers (language:js stars:>100) as needed.' },
        type: { type: 'string', enum: ['repositories','issues'], default: 'repositories', description: 'Search type: repositories or issues.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10, description: 'Max results to return (1-50).' }
      },
      required: ['q']
    },
    async execute({ q, type = 'repositories', limit = 10 }) {
      try {
        const query = String(q || '').trim();
        if (!query) return { error: 'empty_query' };
        const lim = Math.max(1, Math.min(50, Number(limit || 10)));
        const kind = (String(type || 'repositories').toLowerCase() === 'issues') ? 'issues' : 'repositories';
        const base = kind === 'repositories'
          ? 'https://api.github.com/search/repositories'
          : 'https://api.github.com/search/issues';
        const url = `${base}?q=${encodeURIComponent(query)}&per_page=${encodeURIComponent(String(lim))}`;
        const res = await fetchJson(url);
        if (!res.ok) return { error: res.error || `http_${res.status || 0}` };
        const items = Array.isArray(res.data?.items) ? res.data.items : [];
        const results = (kind === 'repositories') ? items.map(simplifyRepo) : items.map(simplifyIssue);
        return {
          query,
          type: kind,
          count: results.length,
          results,
          meta: { rate_limit: res.headers.rate_limit, rate_remaining: res.headers.rate_remaining, rate_reset: res.headers.rate_reset }
        };
      } catch (e) {
        return { error: String(e && e.message || e) };
      }
    }
  };

  try { if (typeof self.registerTool === 'function') self.registerTool(self.GitHubSearchTool); } catch (_) {}
})();


