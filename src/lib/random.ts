// Randomness for generators. Everything goes through crypto.getRandomValues
// with rejection sampling, so passwords are uniform and unpredictable.

/** Uniform integer in [min, max], inclusive. */
export function secureInt(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new RangeError('bad range');
  const range = max - min + 1;
  if (range > 2 ** 32) throw new RangeError('range too large');
  const limit = Math.floor(2 ** 32 / range) * range;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return min + (buf[0] % range);
  }
}

const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*-_=+?',
};

/** Password with at least one character from each set; ambiguous glyphs (l, I, O, 0, 1) left out. */
export function password(length = 20): string {
  const len = Math.min(128, Math.max(8, Math.floor(length)));
  const sets = Object.values(SETS);
  const all = sets.join('');
  const chars = sets.map((s) => s[secureInt(0, s.length - 1)]);
  while (chars.length < len) chars.push(all[secureInt(0, all.length - 1)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureInt(0, i);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}
