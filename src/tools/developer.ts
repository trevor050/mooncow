import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { base64Decode } from '@/lib/hash';
import { answer } from './_helpers';

// Paste-and-inspect utilities: JWTs, JSON, and text counts. Everything is
// decoded locally; nothing pasted here leaves the browser.

export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null;
  try {
    const header = JSON.parse(base64Decode(parts[0]) || 'null');
    const payload = JSON.parse(base64Decode(parts[1]) || 'null');
    if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;
    return { header, payload };
  } catch {
    return null;
  }
}

export function parseJsonInput(text: string): unknown | undefined {
  const t = text.trim();
  if (!/^[[{]/.test(t) || t.length < 2) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

export function countText(text: string): { words: number; chars: number; charsNoSpaces: number; lines: number } {
  return {
    words: (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length,
    chars: [...text].length,
    charsNoSpaces: [...text.replace(/\s/g, '')].length,
    lines: text ? text.split(/\r?\n/).length : 0,
  };
}

export default defineTool({
  id: 'developer',
  name: 'Inspect',
  description: 'Paste a JWT or JSON to decode or format it locally; count words and characters.',
  examples: ['eyJhbGciOi… (a JWT)', '{"a":1,"b":[2,3]}', 'count the quick brown fox'],
  match(q) {
    const jwt = decodeJwt(q.text);
    if (jwt) {
      const exp = typeof jwt.payload.exp === 'number' ? new Date(jwt.payload.exp * 1000) : null;
      const expired = exp ? exp.getTime() < Date.now() : false;
      const pretty = JSON.stringify(jwt.payload, null, 2);
      return {
        id: 'jwt',
        kind: 'answer',
        title: `JWT · ${String(jwt.header.alg || 'unknown alg')}`,
        answer: Object.keys(jwt.payload).slice(0, 6).map((k) => `${k}: ${JSON.stringify(jwt.payload[k])}`).join(' · '),
        subtitle: exp ? `${expired ? 'Expired' : 'Expires'} ${exp.toLocaleString()} · signature not verified` : 'Signature not verified',
        icon: { glyph: 'key' },
        relevance: RELEVANCE.parsed,
        accessory: 'Copy',
        actions: [copyAction(pretty, 'Copy payload JSON'), copyAction(JSON.stringify(jwt.header, null, 2), 'Copy header JSON')],
      } satisfies Result;
    }

    const json = parseJsonInput(q.text);
    if (json !== undefined) {
      const pretty = JSON.stringify(json, null, 2);
      const size = Array.isArray(json) ? `Array of ${json.length}` : `Object with ${Object.keys(json as object).length} keys`;
      return {
        ...answer({ id: 'json', title: 'Valid JSON', answer: size, glyph: 'code', relevance: RELEVANCE.parsed }),
        actions: [copyAction(pretty, 'Copy formatted'), copyAction(JSON.stringify(json), 'Copy minified')],
      };
    }

    const text = q.commandWithArg('count', 'wc', 'word count', 'char count', 'character count');
    if (text) {
      const c = countText(text);
      return answer({ id: 'count', title: 'Text count', answer: `${c.words} words · ${c.chars} characters`, subtitle: `${c.charsNoSpaces} without spaces · ${c.lines} line${c.lines === 1 ? '' : 's'}`, copy: String(c.words), glyph: 'text', relevance: RELEVANCE.explicit });
    }
    return null;
  },
});
