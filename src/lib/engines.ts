// Search engines and sites reachable with "@alias query" or "query alias".

export interface Engine {
  key: string;
  name: string;
  url: string;
  aliases: string[];
  /** Domain used for the favicon. */
  domain: string;
}

const E = (key: string, name: string, url: string, aliases: string[]): Engine => ({
  key, name, url, aliases, domain: new URL(url).hostname.replace(/^www\./, ''),
});

export const ENGINES: Engine[] = [
  E('google', 'Google', 'https://www.google.com/search?q=', ['g', 'google']),
  E('youtube', 'YouTube', 'https://www.youtube.com/results?search_query=', ['yt', 'youtube']),
  E('github', 'GitHub', 'https://github.com/search?q=', ['gh', 'github']),
  E('reddit', 'Reddit', 'https://www.reddit.com/search/?q=', ['r', 'reddit']),
  E('wikipedia', 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search=', ['w', 'wiki', 'wikipedia']),
  E('x', 'X', 'https://x.com/search?q=', ['x', 'twitter']),
  E('maps', 'Google Maps', 'https://www.google.com/maps/search/?api=1&query=', ['maps', 'map']),
  E('images', 'Google Images', 'https://www.google.com/search?tbm=isch&q=', ['img', 'images']),
  E('news', 'Google News', 'https://news.google.com/search?q=', ['news']),
  E('scholar', 'Google Scholar', 'https://scholar.google.com/scholar?q=', ['scholar']),
  E('ddg', 'DuckDuckGo', 'https://duckduckgo.com/?q=', ['ddg', 'duckduckgo']),
  E('bing', 'Bing', 'https://www.bing.com/search?q=', ['bing']),
  E('kagi', 'Kagi', 'https://kagi.com/search?q=', ['kagi']),
  E('brave', 'Brave Search', 'https://search.brave.com/search?q=', ['brave']),
  E('chatgpt', 'ChatGPT', 'https://chatgpt.com/?q=', ['gpt', 'chatgpt']),
  E('claude', 'Claude', 'https://claude.ai/new?q=', ['claude']),
  E('perplexity', 'Perplexity', 'https://www.perplexity.ai/search?q=', ['ppx', 'perplexity']),
  E('so', 'Stack Overflow', 'https://stackoverflow.com/search?q=', ['so', 'stackoverflow']),
  E('mdn', 'MDN', 'https://developer.mozilla.org/en-US/search?q=', ['mdn']),
  E('npm', 'npm', 'https://www.npmjs.com/search?q=', ['npm']),
  E('pypi', 'PyPI', 'https://pypi.org/search/?q=', ['pypi', 'pip']),
  E('crates', 'crates.io', 'https://crates.io/search?q=', ['crates', 'cargo']),
  E('pkggo', 'Go packages', 'https://pkg.go.dev/search?q=', ['go', 'pkggo']),
  E('docker', 'Docker Hub', 'https://hub.docker.com/search?q=', ['docker']),
  E('hn', 'Hacker News', 'https://hn.algolia.com/?q=', ['hn']),
  E('arxiv', 'arXiv', 'https://arxiv.org/search/?searchtype=all&query=', ['arxiv']),
  E('amazon', 'Amazon', 'https://www.amazon.com/s?k=', ['amzn', 'amazon']),
  E('ebay', 'eBay', 'https://www.ebay.com/sch/i.html?_nkw=', ['ebay']),
  E('imdb', 'IMDb', 'https://www.imdb.com/find?q=', ['imdb']),
  E('spotify', 'Spotify', 'https://open.spotify.com/search/', ['spotify', 'sp']),
  E('twitch', 'Twitch', 'https://www.twitch.tv/search?term=', ['twitch', 'ttv']),
  E('steam', 'Steam', 'https://store.steampowered.com/search/?term=', ['steam']),
  E('osm', 'OpenStreetMap', 'https://www.openstreetmap.org/search?query=', ['osm']),
];

const BY_ALIAS = new Map<string, Engine>();
for (const engine of ENGINES) for (const alias of engine.aliases) BY_ALIAS.set(alias, engine);

export function engineByAlias(alias: string): Engine | undefined {
  return BY_ALIAS.get(alias.toLowerCase().replace(/^@/, ''));
}

export function engineUrl(engine: Engine, query: string): string {
  return engine.url + encodeURIComponent(query);
}

/** Aliases that are also common words are not accepted as trailing triggers ("go", "news", "map"). */
const SUFFIX_SAFE = new Set(ENGINES.flatMap((e) => e.aliases).filter((a) => a.length >= 2 && !['go', 'news', 'map', 'maps', 'images', 'img', 'w', 'r', 'g', 'x', 'sp', 'pip'].includes(a)));

export function isSuffixAlias(alias: string): boolean {
  return SUFFIX_SAFE.has(alias.toLowerCase());
}
