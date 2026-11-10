// Example tool: a dice roller.
//
// This file exists mainly to show the tool API end to end, and it is the
// example used in the README. It is registered like every built-in, so you
// can try it: open the palette and type "roll 2d6+3" or "d20".
//
// A tool answers three questions:
//   1. Does this query belong to me?   -> match() returns results or null
//   2. How sure am I?                   -> relevance, using the RELEVANCE bands
//   3. What does it look like and do?   -> title/answer/icon, plus actions

import { copyAction, defineTool, RELEVANCE } from '@/core';
import { secureInt } from '@/lib/random';

/** "2d6+3" -> { count: 2, sides: 6, modifier: 3 } */
export function parseDice(spec: string): { count: number; sides: number; modifier: number } | null {
  const m = spec.replace(/\s+/g, '').match(/^(\d{0,2})d(\d{1,3})([+-]\d{1,3})?$/i);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  if (count < 1 || count > 50 || sides < 2) return null;
  return { count, sides, modifier: m[3] ? parseInt(m[3], 10) : 0 };
}

export default defineTool({
  id: 'dice',
  name: 'Dice',
  description: 'Roll dice in standard notation: d20, 2d6+3, roll 4d8.',
  examples: ['roll', 'd20', 'roll 2d6+3'],

  match(query) {
    // Precise matching: either the whole query is dice notation ("d20"), or it
    // starts with the word "roll". `query.command` only matches a leading
    // trigger, so "how to roll sushi" never reaches us.
    const afterRoll = query.command('roll', 'roll dice', 'roll a die');
    const spec = afterRoll === '' ? 'd6' : afterRoll ?? query.text;
    const dice = parseDice(spec);
    if (!dice) return null;

    const rolls = Array.from({ length: dice.count }, () => secureInt(1, dice.sides));
    const total = rolls.reduce((sum, r) => sum + r, 0) + dice.modifier;
    const notation = `${dice.count}d${dice.sides}${dice.modifier ? (dice.modifier > 0 ? '+' : '') + dice.modifier : ''}`;

    return {
      id: 'roll',
      kind: 'answer',
      title: `Roll ${notation}`,
      answer: String(total),
      subtitle: dice.count > 1 || dice.modifier ? `Rolls: ${rolls.join(' + ')}${dice.modifier ? ` ${dice.modifier > 0 ? '+' : '−'} ${Math.abs(dice.modifier)}` : ''}` : undefined,
      icon: { glyph: 'dice' },
      // An explicit "roll …" is a command; bare notation parsed cleanly.
      relevance: afterRoll !== null ? RELEVANCE.explicit : RELEVANCE.parsed,
      accessory: 'Copy',
      actions: [
        copyAction(String(total)),
        // Actions can drive the palette too: refresh() re-runs match().
        { title: 'Roll again', run: (ctx) => ctx.refresh() },
      ],
    };
  },
});
