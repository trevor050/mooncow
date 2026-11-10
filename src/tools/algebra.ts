import { copyAction, openAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE } from '@/core/types';

// Solves single-variable equations with nerdamer. Detection is cheap and
// synchronous; nerdamer (~500 KB) is loaded on first use so the palette still
// opens instantly.

type Nerdamer = typeof import('nerdamer');
let nerdamerPromise: Promise<Nerdamer> | null = null;
const loadNerdamer = () => (nerdamerPromise ??= import('nerdamer').then((m) => ((m as { default?: Nerdamer }).default ?? m) as Nerdamer));

/** Returns the variable letter if `text` is a one-variable equation, else null. */
export function equationVariable(text: string): string | null {
  const s = text.trim();
  if ((s.match(/=/g) || []).length !== 1) return null;
  const [lhs, rhs] = s.split('=').map((x) => x.trim());
  if (!lhs || !rhs) return null;
  const stripped = s.replace(/\b(sqrt|sin|cos|tan|log|ln|abs|exp)\b/gi, '');
  if (!/^[\d\sa-z.+\-*/^()√²³]+=[\d\sa-z.+\-*/^()√²³]+$/i.test(stripped)) return null;
  const letters = new Set((stripped.match(/[a-z]/gi) || []).map((c) => c.toLowerCase()));
  if (letters.size !== 1) return null;
  if (/[a-z]{2,}/i.test(stripped)) return null; // words, not algebra
  if (!/[\d+\-*/^]/.test(stripped)) return null;
  return [...letters][0];
}

export function normalizeEquation(text: string): string {
  return text
    .replace(/[–—−]/g, '-')
    .replace(/√/g, 'sqrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/(\d)\s*([a-z(])/gi, '$1*$2')
    .replace(/\)\s*([a-z0-9(])/gi, ')*$1')
    .replace(/\s+/g, '');
}

export async function solve(text: string, variable: string): Promise<string[]> {
  const nerdamer = await loadNerdamer();
  const [lhs, rhs] = normalizeEquation(text).split('=');
  const solutions = nerdamer.solve(`(${lhs})-(${rhs})`, variable).toString();
  // nerdamer 2 prints solution sets as "{a, b}" (older versions used "[a, b]").
  const parts = solutions.replace(/^[[{]|[\]}]$/g, '').split(',').map((p) => p.trim()).filter(Boolean);
  const pretty = parts.map((p) => {
    try {
      const n = Number(nerdamer(p).evaluate().valueOf());
      if (Number.isFinite(n)) return String(parseFloat(n.toPrecision(10)));
    } catch {}
    return p.replace(/sqrt\(/g, '√(');
  });
  return [...new Set(pretty)];
}

export default defineTool({
  id: 'algebra',
  name: 'Equation solver',
  description: 'Solves one-variable equations, including quadratics.',
  examples: ['5x + 3 = 8', 'x^2 - 5x + 6 = 0', '2(y - 1) = y + 4'],
  match(q) {
    const variable = equationVariable(q.text);
    if (!variable) return null;
    void loadNerdamer();
    const wolfram = `https://www.wolframalpha.com/input?i=${encodeURIComponent(`solve ${q.text}`)}`;
    return {
      id: 'solve',
      kind: 'answer',
      title: q.text,
      answer: 'Solving…',
      icon: { glyph: 'calc' },
      relevance: RELEVANCE.parsed,
      accessory: 'Copy',
      actions: [openAction(wolfram, 'Open in WolframAlpha')],
      async hydrate() {
        const solutions = await solve(q.text, variable);
        if (!solutions.length) return { answer: 'No solution', actions: [openAction(wolfram, 'Open in WolframAlpha')] };
        const text = `${variable} = ${solutions.join(', ')}`;
        return { answer: text, actions: [copyAction(solutions.join(', ')), openAction(wolfram, 'Open in WolframAlpha')] };
      },
    };
  },
});
