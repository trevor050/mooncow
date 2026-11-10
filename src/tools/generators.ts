import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { password, secureInt, uuid } from '@/lib/random';
import { answer } from './_helpers';

const LOREM =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.';

/** Adds a secondary action that copies a freshly generated value. */
function regenerate(result: Result, make: () => Result): Result {
  return {
    ...result,
    actions: [
      ...result.actions,
      {
        title: 'Copy a new one',
        async run(ctx) {
          const next = make().answer || '';
          await ctx.copy(next);
          ctx.toast(`Copied ${next}`);
        },
      },
    ],
  };
}

export default defineTool({
  id: 'generators',
  name: 'Generators',
  description: 'Passwords, UUIDs, coin flips, random numbers and placeholder text. All randomness comes from crypto.getRandomValues.',
  examples: ['password', 'password 32', 'uuid', 'flip a coin', 'random 1-100', 'lorem 3'],
  match(q) {
    const pw = q.command('password', 'pw', 'passgen', 'generate password', 'new password', 'random password');
    if (pw !== null && /^\d{0,3}$/.test(pw)) {
      const length = pw ? Math.min(128, Math.max(8, parseInt(pw, 10))) : 20;
      const make = () => answer({ id: 'password', title: `${length}-character password`, answer: password(length), glyph: 'key', relevance: RELEVANCE.explicit });
      return regenerate(make(), make);
    }

    if (q.is('uuid', 'guid', 'uuid v4', 'new uuid', 'generate uuid')) {
      const make = () => answer({ id: 'uuid', title: 'UUID v4', answer: uuid(), glyph: 'hash', relevance: RELEVANCE.explicit });
      return regenerate(make(), make);
    }

    if (q.is('flip a coin', 'coin flip', 'flip coin', 'coin toss', 'toss a coin', 'heads or tails', 'coin')) {
      return answer({ id: 'coin', title: 'Coin flip', answer: secureInt(0, 1) ? 'Heads' : 'Tails', glyph: 'dice', relevance: RELEVANCE.explicit });
    }

    const rand = q.command('random', 'rand', 'random number', 'rng', 'pick a number');
    if (rand !== null) {
      const m = rand.match(/^(?:between\s+)?(-?\d+)\s*(?:-|to|and|\.\.)\s*(-?\d+)$/i) || (rand === '' ? ['', '1', '100'] : null);
      if (m) {
        const [lo, hi] = [parseInt(m[1], 10), parseInt(m[2], 10)].sort((a, b) => a - b);
        const make = () => answer({ id: 'random', title: `Random number ${lo}–${hi}`, answer: String(secureInt(lo, hi)), glyph: 'dice', relevance: RELEVANCE.explicit });
        return regenerate(make(), make);
      }
    }

    const lorem = q.command('lorem', 'lorem ipsum', 'lipsum', 'placeholder text');
    if (lorem !== null && /^\d{0,2}$/.test(lorem)) {
      const n = Math.max(1, Math.min(10, parseInt(lorem || '1', 10)));
      const text = Array.from({ length: n }, () => LOREM).join('\n\n');
      return { ...answer({ id: 'lorem', title: `Lorem ipsum, ${n} paragraph${n > 1 ? 's' : ''}`, answer: LOREM.slice(0, 90) + '…', glyph: 'text', relevance: RELEVANCE.explicit }), actions: [copyAction(text)] };
    }
    return null;
  },
});
