import { defineTool } from '@/core/registry';
import { RELEVANCE } from '@/core/types';
import { formatNumber, tryCalculate } from '@/lib/calc';
import { answer } from './_helpers';

const money = (n: number) => `$${n.toFixed(2)}`;
const NUM = String.raw`(-?[\d,]*\.?\d+)`;
const parse = (s: string) => parseFloat(s.replace(/,/g, ''));

const PERCENT_OF = new RegExp(String.raw`^${NUM}\s*%\s*of\s*\$?${NUM}$`, 'i');
const TIP = new RegExp(String.raw`^tip\s+${NUM}\s*%?\s+(?:on\s+)?\$?${NUM}(?:\s+(?:for|split|x|between)\s+(\d+)(?:\s+people)?)?$`, 'i');
const SPLIT = new RegExp(String.raw`^split\s+\$?${NUM}\s+(?:by\s+|between\s+|among\s+|for\s+|in\s+)?(\d+)(?:\s+(?:ways|people))?$`, 'i');

export default defineTool({
  id: 'calculator',
  name: 'Calculator',
  description: 'Arithmetic with functions, constants, percentages and tips.',
  examples: ['2+2*3', 'sqrt(2)^2', '15% of 80', 'tip 18% 64.20 for 3', 'split 120 4 ways', '= sin(30deg)'],
  match(q) {
    const pct = q.match(PERCENT_OF);
    if (pct) {
      const value = (parse(pct[1]) / 100) * parse(pct[2]);
      return answer({ id: 'percent', title: q.text, answer: formatNumber(value), glyph: 'calc' });
    }

    const tip = q.match(TIP);
    if (tip) {
      const rate = parse(tip[1]);
      const bill = parse(tip[2]);
      const people = Math.max(1, parseInt(tip[3] || '1', 10));
      const tipAmount = (bill * rate) / 100;
      const total = bill + tipAmount;
      return answer({
        id: 'tip',
        title: `${rate}% tip on ${money(bill)}${people > 1 ? ` for ${people}` : ''}`,
        answer: people > 1 ? `${money(total / people)} each` : money(total),
        subtitle: `Tip ${money(tipAmount)} · total ${money(total)}`,
        copy: money(people > 1 ? total / people : total),
        glyph: 'calc',
        relevance: RELEVANCE.explicit,
      });
    }

    const split = q.match(SPLIT);
    if (split) {
      const ways = Math.max(1, parseInt(split[2], 10));
      const each = parse(split[1]) / ways;
      return answer({ id: 'split', title: `${money(parse(split[1]))} split ${ways} ways`, answer: `${money(each)} each`, copy: money(each), glyph: 'calc', relevance: RELEVANCE.explicit });
    }

    const calc = tryCalculate(q.text);
    if (!calc) return null;
    return answer({
      id: 'calc',
      title: calc.expression,
      answer: calc.formatted,
      glyph: 'calc',
      relevance: q.text.startsWith('=') ? RELEVANCE.explicit : RELEVANCE.parsed,
    });
  },
});
