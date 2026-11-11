import { fuzzyMatch, subsequenceScore } from '@/core/fuzzy';
import { Query } from '@/core/query';
import { learnedBoost, MAX_LEARNED_BOOST, rank, recordPick, scoreResult } from '@/core/ranking';
import { defineTool, ToolRegistry } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { ctx } from './helpers';

const r = (over: Partial<Result>): Result => ({ id: over.title || 'x', title: 'x', kind: 'search', relevance: 0.5, actions: [], ...over });

describe('Query', () => {
  it('normalizes whitespace and case', () => {
    const q = new Query('  Define   Serendipity ');
    expect(q.text).toBe('Define Serendipity');
    expect(q.lower).toBe('define serendipity');
    expect(q.words).toEqual(['Define', 'Serendipity']);
  });

  it('command() only matches a leading trigger', () => {
    expect(new Query('define cat').command('define')).toBe('cat');
    expect(new Query('define').command('define')).toBe('');
    expect(new Query('please define cat').command('define')).toBeNull();
    expect(new Query('defined').command('define')).toBeNull();
    expect(new Query('how to spell cat').command('how to spell')).toBe('cat');
  });

  it('commandWithArg() requires an argument', () => {
    expect(new Query('sha256').commandWithArg('sha256')).toBeNull();
    expect(new Query('sha256 x').commandWithArg('sha256')).toBe('x');
  });

  it('is() matches the whole query only', () => {
    expect(new Query('Flip a coin').is('flip a coin')).toBe(true);
    expect(new Query('flip a coin please').is('flip a coin')).toBe(false);
  });

  it('prefixOf() needs the whole query to start a phrase', () => {
    expect(new Query('dupl').prefixOf(['duplicate tab'])).toBe(true);
    expect(new Query('du').prefixOf(['duplicate tab'])).toBe(false);
    expect(new Query('back to the future').prefixOf(['go back', 'back'])).toBe(false);
  });

  it('suffix() matches a trailing trigger', () => {
    expect(new Query('lofi youtube').suffix('youtube')).toEqual({ rest: 'lofi', trigger: 'youtube' });
    expect(new Query('youtube').suffix('youtube')).toBeNull();
  });
});

describe('fuzzyMatch', () => {
  const gmail = { title: 'Inbox (3) - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' };
  it('ranks exact > prefix > word starts > substring > subsequence', () => {
    expect(fuzzyMatch('github', { title: 'GitHub', url: 'https://github.com' })).toBe(1);
    expect(fuzzyMatch('inbox', gmail)).toBe(0.95);
    expect(fuzzyMatch('mail goo', gmail)).toBe(0.85);
    expect(fuzzyMatch('box (3', gmail)).toBe(0.7);
    const sub = fuzzyMatch('gml', gmail);
    expect(sub).toBeGreaterThanOrEqual(0.4);
    expect(sub).toBeLessThan(0.7);
  });
  it('stays silent when letters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', gmail)).toBe(0);
    expect(fuzzyMatch('lmg', gmail)).toBe(0);
    expect(subsequenceScore('ab', 'a b c')).toBe(0); // too short for loose matching
  });
});

describe('ranking', () => {
  it('orders by relevance, then kind', () => {
    const out = rank([r({ title: 'web', kind: 'search', relevance: RELEVANCE.fallback }), r({ title: 'calc', kind: 'answer', relevance: RELEVANCE.parsed }), r({ title: 'tab', kind: 'tab', relevance: RELEVANCE.fallback })], 'q');
    expect(out.map((x) => x.title)).toEqual(['calc', 'tab', 'web']);
  });

  it('collapses results for the same page, keeping the best', () => {
    const out = rank([
      r({ title: 'history', kind: 'history', relevance: 0.55, url: 'https://www.example.com/a/' }),
      r({ title: 'tab', kind: 'tab', relevance: 0.8, url: 'https://example.com/a' }),
    ], 'q');
    expect(out.map((x) => x.title)).toEqual(['tab']);
  });

  it('learns from picks without lifting a loose match over a precise one', () => {
    let stats = {};
    for (let i = 0; i < 20; i++) stats = recordPick(stats, 'gith', 'history');
    expect(learnedBoost(stats, 'git', 'history')).toBe(MAX_LEARNED_BOOST);
    const loose = scoreResult(r({ kind: 'history', relevance: RELEVANCE.partial, toolId: 'history' }), 'git', stats);
    const precise = scoreResult(r({ kind: 'answer', relevance: RELEVANCE.parsed, toolId: 'calculator' }), 'git', stats);
    expect(precise).toBeGreaterThan(loose);
    // But it does reorder within a band.
    const a = scoreResult(r({ kind: 'search', relevance: 0.7, toolId: 'web' }), 'git', stats);
    const b = scoreResult(r({ kind: 'history', relevance: 0.68, toolId: 'history' }), 'git', stats);
    expect(b).toBeGreaterThan(a);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => r({ title: `s${i}`, kind: 'suggestion' }));
    expect(rank(many, 'q')).toHaveLength(9);
    expect(rank(many, 'q', {}, 50)).toHaveLength(30);
  });
});

describe('ToolRegistry', () => {
  it('rejects bad and duplicate ids', () => {
    const t = defineTool({ id: 'Bad Id', name: '', description: '', match: () => null });
    expect(() => new ToolRegistry().register(t)).toThrow(/kebab-case/);
    const ok = defineTool({ id: 'ok', name: '', description: '', match: () => null });
    expect(() => new ToolRegistry().register(ok, ok)).toThrow(/already registered/);
  });

  it('namespaces ids and survives a throwing tool', async () => {
    const good = defineTool({ id: 'good', name: '', description: '', match: () => r({ id: 'a', title: 'A' }) });
    const bad = defineTool({ id: 'bad', name: '', description: '', match: () => { throw new Error('boom'); } });
    const out = await new ToolRegistry().register(bad, good).run('x', ctx());
    expect(out.map((x) => x.id)).toEqual(['good:a']);
    expect(out[0].toolId).toBe('good');
  });

  it('streams sync results first and merges async ones', async () => {
    const updates: string[][] = [];
    const sync = defineTool({ id: 'sync', name: '', description: '', match: () => r({ id: 's', title: 'sync', relevance: 0.5 }) });
    const slow = defineTool({ id: 'slow', name: '', description: '', match: async () => r({ id: 'a', title: 'async', relevance: 0.9 }) });
    await new ToolRegistry().register(sync, slow).run('x', ctx(), { onUpdate: (res) => updates.push(res.map((x) => x.title)) });
    expect(updates[0]).toEqual(['sync']);
    expect(updates.at(-1)).toEqual(['async', 'sync']);
  });

  it('never publishes results for a query that has been replaced', async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    const slow = defineTool({ id: 'slow', name: '', description: '', match: async () => { await gate; return r({ title: 'stale' }); } });
    const updates: string[][] = [];
    const done = new ToolRegistry().register(slow).run('old', ctx({ signal: controller.signal }), { onUpdate: (res) => updates.push(res.map((x) => x.title)) });
    controller.abort(); // the user typed something else
    release();
    await done;
    expect(updates.flat()).not.toContain('stale');
  });
});
