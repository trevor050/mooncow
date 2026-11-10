import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { base64Decode, base64Encode, digest, type HashAlgorithm } from '@/lib/hash';
import { answer } from './_helpers';

const words = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);

export const CASES: Record<string, (s: string) => string> = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  title: (s) => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp, c) => sp + c.toUpperCase()),
  camel: (s) => words(s).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(''),
  pascal: (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(''),
  snake: (s) => words(s).map((w) => w.toLowerCase()).join('_'),
  kebab: (s) => words(s).map((w) => w.toLowerCase()).join('-'),
  constant: (s) => words(s).map((w) => w.toUpperCase()).join('_'),
};

const CASE_TRIGGERS: Record<string, string[]> = {
  upper: ['upper', 'uppercase'],
  lower: ['lower', 'lowercase'],
  title: ['title', 'titlecase', 'title case'],
  camel: ['camel', 'camelcase', 'camel case'],
  pascal: ['pascal', 'pascalcase'],
  snake: ['snake', 'snakecase', 'snake case', 'snake_case'],
  kebab: ['kebab', 'kebabcase', 'kebab case', 'slug', 'slugify'],
  constant: ['constant', 'screaming snake'],
};

const HASHES: HashAlgorithm[] = ['md5', 'sha1', 'sha256', 'sha512'];

export function convertBase(text: string): { value: number; target: string; out: string } | null {
  const m = text.trim().match(/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d+)\s+(?:to|in|as)\s+(hex|hexadecimal|bin|binary|oct|octal|dec|decimal)$/i);
  if (!m) return null;
  const src = m[1].toLowerCase();
  const value = src.startsWith('0x') ? parseInt(src.slice(2), 16) : src.startsWith('0b') ? parseInt(src.slice(2), 2) : src.startsWith('0o') ? parseInt(src.slice(2), 8) : parseInt(src, 10);
  if (!Number.isSafeInteger(value)) return null;
  const t = m[2].toLowerCase();
  const out = t.startsWith('hex') ? '0x' + value.toString(16) : t.startsWith('bin') ? '0b' + value.toString(2) : t.startsWith('oct') ? '0o' + value.toString(8) : String(value);
  return { value, target: t, out };
}

export default defineTool({
  id: 'encoders',
  name: 'Encoders',
  description: 'Hashes (MD5, SHA-1/256/512), Base64, URL encoding, number bases and text case.',
  examples: ['sha256 hello', 'base64 hello world', 'base64 decode aGVsbG8=', '255 to hex', '0xff', 'snake Hello World', 'urlencode a b&c'],
  match(q) {
    for (const algo of HASHES) {
      const text = q.commandWithArg(algo, algo.replace('sha', 'sha-'));
      if (text) {
        return {
          id: algo,
          kind: 'answer',
          title: `${algo.toUpperCase()} of “${text.length > 40 ? text.slice(0, 40) + '…' : text}”`,
          answer: '…',
          icon: { glyph: 'hash' },
          relevance: RELEVANCE.explicit,
          accessory: 'Copy',
          actions: [],
          async hydrate() {
            const hex = await digest(algo, text);
            return { answer: hex, actions: [copyAction(hex)] };
          },
        } satisfies Result;
      }
    }

    const decode = q.commandWithArg('base64 decode', 'b64 decode', 'b64d', 'unbase64', 'atob');
    if (decode) {
      const out = base64Decode(decode);
      return answer({ id: 'b64d', title: 'Base64 decoded', answer: out ?? 'Not valid Base64', glyph: 'code', relevance: RELEVANCE.explicit });
    }
    const encode = q.commandWithArg('base64 encode', 'base64', 'b64', 'btoa');
    if (encode) return answer({ id: 'b64', title: 'Base64', answer: base64Encode(encode), glyph: 'code', relevance: RELEVANCE.explicit });

    const urlEnc = q.commandWithArg('urlencode', 'url encode', 'encodeuri');
    if (urlEnc) return answer({ id: 'urlenc', title: 'URL encoded', answer: encodeURIComponent(urlEnc), glyph: 'link', relevance: RELEVANCE.explicit });
    const urlDec = q.commandWithArg('urldecode', 'url decode', 'decodeuri');
    if (urlDec) {
      let out: string;
      try { out = decodeURIComponent(urlDec.replace(/\+/g, ' ')); } catch { out = 'Not valid URL encoding'; }
      return answer({ id: 'urldec', title: 'URL decoded', answer: out, glyph: 'link', relevance: RELEVANCE.explicit });
    }

    for (const [kind, triggers] of Object.entries(CASE_TRIGGERS)) {
      const text = q.commandWithArg(...triggers);
      if (text) return answer({ id: `case:${kind}`, title: `${kind[0].toUpperCase() + kind.slice(1)} case`, answer: CASES[kind](text), glyph: 'text', relevance: RELEVANCE.explicit });
    }

    const base = convertBase(q.text);
    if (base) return answer({ id: 'base', title: `${q.text.split(/\s+/)[0]} in ${base.target}`, answer: base.out, glyph: 'hash' });
    const literal = q.match(/^(0x[0-9a-f]+|0b[01]+|0o[0-7]+)$/i);
    if (literal) {
      const conv = convertBase(`${literal[1]} to dec`);
      if (conv) return answer({ id: 'literal', title: literal[1], answer: conv.out, subtitle: `hex 0x${conv.value.toString(16)} · bin 0b${conv.value.toString(2)}`, glyph: 'hash' });
    }
    return null;
  },
});
