import { RELEVANCE, type Result, type TabInfo } from '@/core/types';
import ai, { looksLikeQuestion } from '@/tools/ai';
import algebra, { equationVariable, solve } from '@/tools/algebra';
import appSearch from '@/tools/app-search';
import browserCommands from '@/tools/browser-commands';
import calculator from '@/tools/calculator';
import color from '@/tools/color';
import converter from '@/tools/converter';
import datetime from '@/tools/datetime';
import developer, { countText, decodeJwt } from '@/tools/developer';
import dice, { parseDice } from '@/tools/dice';
import dictionary, { firstDefinition, misspellingTarget } from '@/tools/dictionary';
import encoders, { CASES, convertBase } from '@/tools/encoders';
import generators from '@/tools/generators';
import history, { autofillSite, googleSearchQuery, historyRelevance, siteScore } from '@/tools/history';
import { BUILTIN_TOOLS } from '@/tools';
import misc, { trackingUrl } from '@/tools/misc';
import palette from '@/tools/palette-commands';
import recentlyClosed from '@/tools/recently-closed';
import tabs, { tabRelevance } from '@/tools/tabs';
import time from '@/tools/time';
import weather, { describeWeatherCode, parseWeatherQuery } from '@/tools/weather';
import web, { toUrl } from '@/tools/web';
import { Query } from '@/core/query';
import { ctx, fakeData, hydrate, NOW, run, runAll } from './helpers';

const first = async (tool: Parameters<typeof run>[0], q: string) => (await run(tool, q))[0];

describe('every built-in tool', () => {
  it('has a unique kebab-case id, a name, a description and examples', () => {
    const ids = BUILTIN_TOOLS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of BUILTIN_TOOLS) {
      expect(t.id).toMatch(/^[a-z0-9-]+$/);
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.examples?.length).toBeGreaterThan(0);
    }
  });

  it('every result has at least one action or a hydrate step', async () => {
    for (const q of ['2+2', '#fff', '10 km to mi', 'define cat', 'weather tokyo', 'password', 'roll d20', 'sha256 x', '>', '@', 'reload', 'days until christmas', '?']) {
      for (const r of await runAll(q)) expect(r.actions.length > 0 || !!r.hydrate).toBe(true);
    }
  });
});

describe('calculator', () => {
  it('answers', async () => {
    expect((await first(calculator, '2+2*3')).answer).toBe('8');
    expect((await first(calculator, '15% of 80')).answer).toBe('12');
    expect((await first(calculator, 'tip 20% 50')).answer).toBe('$60.00');
    expect((await first(calculator, 'tip 18% 64.20 for 3')).answer).toBe('$25.25 each');
    expect((await first(calculator, 'split 120 4 ways')).answer).toBe('$30.00 each');
    expect((await first(calculator, '= 2')).relevance).toBe(RELEVANCE.explicit);
  });
  it('copies the plain value', async () => {
    const r = await first(calculator, '1/3');
    let copied = '';
    await r.actions[0].run({ copy: async (t: string) => { copied = t; }, toast() {} } as never);
    expect(copied).toBe('0.333333333333');
  });
});

describe('algebra', () => {
  it('detects one-variable equations only', () => {
    expect(equationVariable('5x + 3 = 8')).toBe('x');
    expect(equationVariable('2(y - 1) = y + 4')).toBe('y');
    expect(equationVariable('x = y')).toBeNull();
    expect(equationVariable('a = b + c')).toBeNull();
    expect(equationVariable('name = value')).toBeNull();
    expect(equationVariable('2 + 2 = 4')).toBeNull();
    expect(equationVariable('x == 5')).toBeNull();
  });
  it('solves', async () => {
    expect(await solve('5x + 3 = 8', 'x')).toEqual(['1']);
    expect((await solve('x^2 - 5x + 6 = 0', 'x')).sort()).toEqual(['2', '3']);
    expect(await solve('2(y - 1) = y + 4', 'y')).toEqual(['6']);
    expect((await solve('x^2 = 2', 'x')).map(Number).sort()).toEqual([-Math.SQRT2, Math.SQRT2].map((n) => Number(n.toPrecision(10))).sort());
  });
  it('hydrates an answer row', async () => {
    const r = await hydrate(await first(algebra, '3x = 12'), {});
    expect(r.answer).toBe('x = 4');
  });
});

describe('converter', () => {
  it('converts units instantly', async () => {
    expect((await first(converter, '10 km to mi')).answer).toBe('6.2137 mi');
    expect((await first(converter, '100 c to f')).answer).toBe('212 °F');
  });
  it('converts currency with fetched rates', async () => {
    const r = await hydrate(await first(converter, '25 usd to eur'), { 'frankfurter.dev': { date: '2026-11-10', rates: { EUR: 0.9 } } });
    expect(r.answer).toBe('€22.50');
    expect(r.subtitle).toContain('2026-11-10');
  });
});

describe('color', () => {
  it('parses and offers copy formats', async () => {
    const r = await first(color, '#ff8800');
    expect(r.title).toBe('#FF8800');
    expect(r.icon).toEqual({ swatch: '#FF8800' });
    expect(r.actions.map((a) => a.title)).toEqual(['Copy HEX', 'Open color picker', 'Copy RGB', 'Copy HSL']);
    expect((await first(color, 'color 1e90ff')).title).toBe('#1E90FF');
  });
});

describe('dictionary', () => {
  const entries = (def: string) => [{ partOfSpeech: 'Noun', definitions: [{ definition: def }] }];
  it('recognises definition and spelling phrasing', async () => {
    expect((await first(dictionary, 'define serendipity')).title).toBe('serendipity');
    expect((await first(dictionary, 'what does ephemeral mean')).title).toBe('ephemeral');
    expect((await first(dictionary, 'spell definately')).title).toBe('Spelling of “definately”');
    expect((await first(dictionary, 'definately spelling')).title).toBe('Spelling of “definately”');
  });
  it('reads Wiktionary, including misspelling labels', async () => {
    expect(firstDefinition(entries('The <a href="x">phenomenon</a> of luck.'))).toEqual({ pos: 'Noun', text: 'The phenomenon of luck.' });
    expect(misspellingTarget(entries('Misspelling of <a>receive</a>.'))).toBe('receive');
    const spelled = await hydrate(await first(dictionary, 'spell recieve'), { 'wiktionary.org': { en: entries('Misspelling of <a>receive</a>.') } });
    expect(spelled.answer).toBe('receive');
    const defined = await hydrate(await first(dictionary, 'define cat'), { 'wiktionary.org': { en: entries('A small domesticated carnivorous mammal.') } });
    expect(defined.answer).toBe('A small domesticated carnivorous mammal.');
  });
});

describe('weather', () => {
  it('parses places', () => {
    expect(parseWeatherQuery(new Query('weather in new york'))).toBe('new york');
    expect(parseWeatherQuery(new Query('tokyo weather'))).toBe('tokyo');
    expect(parseWeatherQuery(new Query('forecast for lisbon?'))).toBe('lisbon');
    expect(describeWeatherCode(63)).toBe('Rain');
  });
  it('fetches conditions in the local unit', async () => {
    const r = await hydrate(await first(weather, 'weather boston'), {
      'geocoding-api': { results: [{ name: 'Boston', latitude: 42.36, longitude: -71.06, country: 'United States', country_code: 'US', admin1: 'Massachusetts' }] },
      'api.open-meteo.com': { current: { temperature_2m: 51.4, apparent_temperature: 48, weather_code: 3, wind_speed_10m: 9, relative_humidity_2m: 60 }, daily: { temperature_2m_max: [55], temperature_2m_min: [44] } },
    });
    expect(r.answer).toBe('51°F · Overcast');
    expect(r.title).toBe('Boston, Massachusetts, United States');
  });
});

describe('time and dates', () => {
  it('tells the time in a city', async () => {
    const r = await first(time, 'time in tokyo');
    expect(r.answer).toBe('12:00 AM'); // 15:00 UTC = midnight in Tokyo
    expect(r.subtitle).toContain('GMT+9');
    expect((await first(time, 'london time')).answer).toBe('3:00 PM');
  });
  it('does date math and zones', async () => {
    expect((await first(datetime, 'days until christmas')).answer).toBe('45 days');
    expect((await first(datetime, '3pm est in tokyo')).answer).toBe('5:00 AM (next day)');
    expect((await first(datetime, 'unix 1700000000')).subtitle).toBe('2023-11-14T22:13:20.000Z');
    expect((await first(datetime, 'timestamp')).answer).toBe(String(Math.floor(NOW / 1000)));
  });
});

describe('encoders and inspectors', () => {
  it('hashes for real (regression: the old "hash" was base64)', async () => {
    const r = await hydrate(await first(encoders, 'md5 hello'), {});
    expect(r.answer).toBe('5d41402abc4b2a76b9719d911017c592');
    const s = await hydrate(await first(encoders, 'sha256 hello'), {});
    expect(s.answer).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
  it('encodes', async () => {
    expect((await first(encoders, 'base64 hello world')).answer).toBe('aGVsbG8gd29ybGQ=');
    expect((await first(encoders, 'base64 decode aGVsbG8gd29ybGQ=')).answer).toBe('hello world');
    expect((await first(encoders, 'urlencode a b&c')).answer).toBe('a%20b%26c');
    expect((await first(encoders, 'snake Hello World')).answer).toBe('hello_world');
    expect(CASES.camel('make it camel case')).toBe('makeItCamelCase');
    expect(CASES.kebab('XMLHttpRequest thing')).toBe('xml-http-request-thing');
    expect(convertBase('255 to hex')?.out).toBe('0xff');
    expect(convertBase('0b1010 to dec')?.out).toBe('10');
    expect((await first(encoders, '0xff')).answer).toBe('255');
  });
  it('decodes JWTs and JSON locally', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(decodeJwt(jwt)?.payload).toEqual({ sub: '1234567890', name: 'John Doe', iat: 1516239022 });
    expect((await first(developer, jwt)).title).toBe('JWT · HS256');
    expect((await first(developer, '{"a":1,"b":[2,3]}')).answer).toBe('Object with 2 keys');
    expect(countText('Hello, world!\nIt’s me.')).toEqual({ words: 4, chars: 22, charsNoSpaces: 19, lines: 2 });
  });
});

describe('generators and dice', () => {
  it('generates on explicit commands', async () => {
    expect((await first(generators, 'password 32')).answer).toHaveLength(32);
    expect((await first(generators, 'uuid')).answer).toMatch(/^[0-9a-f-]{36}$/);
    expect(['Heads', 'Tails']).toContain((await first(generators, 'flip a coin')).answer);
    const n = Number((await first(generators, 'random 1-6')).answer);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(6);
  });
  it('rolls dice', async () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 });
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 });
    expect(parseDice('d1')).toBeNull();
    const r = await first(dice, 'roll 2d6+3');
    expect(Number(r.answer)).toBeGreaterThanOrEqual(5);
    expect(Number(r.answer)).toBeLessThanOrEqual(15);
    expect((await first(dice, 'roll')).title).toBe('Roll 1d6');
  });
});

describe('web and site search', () => {
  it('recognises addresses', () => {
    expect(toUrl('github.com/trevor050')).toBe('https://github.com/trevor050');
    expect(toUrl('localhost:5173')).toBe('http://localhost:5173');
    expect(toUrl('https://example.com')).toBe('https://example.com/');
    expect(toUrl('e.g')).toBeNull();
    expect(toUrl('hello world.com')).toBeNull();
    expect(toUrl('node.js')).toBe('https://node.js/'); // a real TLD shape; web search stays one row below
  });
  it('always offers web search, and suggestions only when enabled', async () => {
    const data = fakeData({ suggestions: async () => ['ramen near me'] });
    expect((await run(web, 'ramen', ctx({ data }))).map((r) => r.kind)).toEqual(['search']);
    const on = await run(web, 'ramen', ctx({ data, settings: { ...ctx().settings, suggestions: true } }));
    expect(on.map((r) => r.kind)).toEqual(['search', 'suggestion']);
  });
  it('searches sites by @alias and trailing name', async () => {
    expect((await first(appSearch, '@yt lofi')).actions[0].title).toBe('Search YouTube');
    expect((await first(appSearch, 'lofi youtube')).subtitle).toBe('Search YouTube');
    expect((await run(appSearch, '@')).length).toBeGreaterThan(5);
    expect(await run(appSearch, '@nope thing')).toEqual([]);
  });
});

describe('browser objects', () => {
  const tab = (over: Partial<TabInfo>): TabInfo => ({ id: 1, windowId: 1, title: '', url: '', pinned: false, active: false, audible: false, muted: false, lastAccessed: NOW - 60_000, ...over });
  const openTabs = [
    tab({ id: 1, title: 'Inbox - Gmail', url: 'https://mail.google.com/mail/u/0/' }),
    tab({ id: 2, title: 'WXT docs', url: 'https://wxt.dev/guide/' }),
    tab({ id: 3, title: 'Current page', url: 'https://example.com', active: true }),
  ];
  const data = fakeData({ tabs: async () => openTabs });

  it('finds open tabs fuzzily and ranks them above web search', async () => {
    const results = await runAll('gmail', ctx({ data }));
    expect(results[0].title).toBe('Inbox - Gmail');
    expect(results[0].kind).toBe('tab');
    expect((await run(tabs, 'gml', ctx({ data })))[0]?.title).toBe('Inbox - Gmail');
    expect(await run(tabs, 'current', ctx({ data }))).toEqual([]); // the tab you are on is not a destination
  });
  it('gives tab rows verbs', async () => {
    const [r] = await run(tabs, 'wxt', ctx({ data }));
    expect(r.actions.map((a) => a.title)).toEqual(['Switch to tab', 'Close tab', 'Pin tab', 'Mute tab', 'Duplicate tab', 'Move to new window', 'Reload tab', 'Copy URL']);
  });
  it('maps match quality onto relevance bands', () => {
    expect(tabRelevance(0.95)).toBeGreaterThan(RELEVANCE.fallback);
    expect(tabRelevance(0.85)).toBeGreaterThan(RELEVANCE.fallback);
    expect(tabRelevance(0.45)).toBeLessThan(RELEVANCE.fallback);
    expect(tabRelevance(0)).toBe(0);
  });
  it('lists and finds recently closed tabs', async () => {
    const closed = fakeData({ recentlyClosed: async () => [{ sessionId: 's1', title: 'Hacker News', url: 'https://news.ycombinator.com/', closedAt: NOW - 120_000 }] });
    expect((await run(recentlyClosed, 'closed', ctx({ data: closed })))[0].subtitle).toContain('closed 2 min ago');
    expect((await run(recentlyClosed, 'hacker', ctx({ data: closed })))[0]?.title).toBe('Hacker News');
    expect(await run(recentlyClosed, 'zzz', ctx({ data: closed }))).toEqual([]);
  });
  it('autofills frequent domains but defers to an open tab', () => {
    const site = (domain: string, over = {}) => ({ domain, visitCount: 20, typedCount: 2, lastVisitTime: NOW - 3_600_000, daysActive: 10, openCount: 0, ...over });
    expect(autofillSite([site('github.com'), site('gitlab.com', { visitCount: 2, daysActive: 1, typedCount: 0, lastVisitTime: NOW - 10 * 86_400_000 })], 'git', NOW)?.domain).toBe('github.com');
    expect(autofillSite([site('github.com', { openCount: 1 })], 'git', NOW)).toBeNull();
    expect(autofillSite([site('github.com')], 'g h', NOW)).toBeNull();
    expect(siteScore(site('a.com', { daysActive: 12 }), NOW)).toBeGreaterThan(siteScore(site('b.com', { daysActive: 1 }), NOW));
  });
  it('turns past Google searches into local completions', async () => {
    expect(googleSearchQuery('https://www.google.com/search?q=ramen+recipe&oq=x')).toBe('ramen recipe');
    expect(googleSearchQuery('https://www.google.com/maps?q=x')).toBeNull();
    const h = fakeData({ history: async () => [{ url: 'https://www.google.com/search?q=ramen+recipe', title: 'ramen recipe - Google Search', visitCount: 1, typedCount: 0, lastVisitTime: NOW - 3_600_000 }] });
    const results = await run(history, 'ramen', ctx({ data: h }));
    expect(results.find((r) => r.id.startsWith('searched:'))?.title).toBe('ramen recipe');
  });
  it('keeps one-off history below web search', () => {
    expect(historyRelevance(0.85, 1)).toBeLessThan(RELEVANCE.fallback);
    expect(historyRelevance(0.95, 500)).toBeGreaterThan(RELEVANCE.fallback - 0.02);
  });
  it('matches commands by name prefix, scaled by how much is typed', async () => {
    expect((await first(browserCommands, 'reload')).relevance).toBe(RELEVANCE.explicit);
    expect((await first(browserCommands, 'rel'))?.relevance ?? 0).toBeLessThan(RELEVANCE.fallback);
    expect((await first(browserCommands, 'close dup')).title).toBe('Close duplicate tabs');
    expect((await run(browserCommands, '>')).length).toBeGreaterThan(20);
    expect((await run(browserCommands, '> pin')).map((r) => r.title)).toEqual(['Pin tab']);
    expect((await run(browserCommands, '> close')).map((r) => r.title)).toEqual(['Close tab', 'Close other tabs', 'Close tabs to the right', 'Close duplicate tabs', 'Reopen closed tab']);
  });
});

describe('AI and palette commands', () => {
  it('ranks natural questions higher than plain words', async () => {
    expect(looksLikeQuestion('why is the sky blue?')).toBe(true);
    expect(looksLikeQuestion('how do i center a div')).toBe(true);
    expect(looksLikeQuestion('ramen')).toBe(false);
    expect((await first(ai, 'ai explain monads')).relevance).toBe(RELEVANCE.explicit);
    expect((await first(ai, 'ramen')).relevance).toBeLessThan(RELEVANCE.fallback);
  });
  it('offers the help list, settings and themes', async () => {
    expect((await first(palette, '?')).title).toBe('What MoonCow can do');
    expect((await first(palette, 'settings')).title).toBe('MoonCow settings');
    expect((await first(palette, 'dark mode')).title).toBe('Use dark theme');
    expect((await first(palette, 'qr hello')).title).toContain('hello');
  });
  it('misc', async () => {
    expect(trackingUrl('1Z999AA10123456784')?.carrier).toBe('UPS');
    expect((await first(misc, 'gh wxt-dev/wxt')).url).toBe('https://github.com/wxt-dev/wxt');
    expect((await first(misc, 'email a@b.co lunch?')).actions[0]).toBeTruthy();
  });
});

// ---------------------------------------------------------------- silence
// A tool that fires when it should not teaches people to stop trusting the bar.
// Each of these queries must not produce a high-confidence answer or command.
const MUST_STAY_QUIET: [string, string[]][] = [
  ['back to the future', ['browser-commands']],
  ['time complexity of quicksort', ['time', 'datetime']],
  ['dinner time', ['time']],
  ['password manager reviews', ['generators']],
  ['how to roll sushi', ['dice']],
  ['random access memory', ['generators']],
  ['coin collecting', ['generators']],
  ['flip phone', ['generators']],
  ['setup a react project', ['palette']],
  ['reload pistol', ['browser-commands']],
  ['pinterest', ['browser-commands']],
  ['color theory basics', ['color']],
  ['best red paint', ['color']],
  ['hash browns recipe', ['encoders']],
  ['base64', ['encoders']],
  ['mute swan', ['browser-commands']],
  ['weather the storm meaning', ['weather']],
  ['the define keyword in c', ['dictionary']],
  ['2024-01-15', ['calculator']],
  ['iphone 15', ['calculator', 'converter']],
  ['10 things to do in paris', ['converter', 'datetime']],
  ['x = y', ['algebra']],
  ['days of our lives', ['datetime']],
  ['new york times', ['time', 'datetime']],
  ['call 2125551234', ['datetime', 'misc']],
  ['uuid generator online', ['generators']],
];

describe('precision: tools stay silent on look-alike queries', () => {
  it.each(MUST_STAY_QUIET)('%j', async (query, toolIds) => {
    const results = await runAll(query);
    for (const r of results) {
      if (!toolIds.includes(r.toolId!)) continue;
      expect.soft(r.relevance, `${r.toolId} fired on "${query}" with "${r.title}"`).toBeLessThan(RELEVANCE.fallback);
    }
    // And none of them wins the top spot.
    expect.soft(toolIds).not.toContain(results[0]?.toolId);
  });
});
