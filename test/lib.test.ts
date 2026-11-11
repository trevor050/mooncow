import { evaluate, formatNumber, tryCalculate } from '@/lib/calc';
import { contrastRatio, formatHsl, formatRgb, parseColor, scale, toHex } from '@/lib/color';
import { formatMoney, parseCurrency } from '@/lib/currency';
import { addToDate, describeTimestamp, parseClock, parseDate, parseDateQuery, parseZoneConversion, zoneOffset } from '@/lib/dates';
import { base64Decode, base64Encode, digest, md5 } from '@/lib/hash';
import { password, secureInt, uuid } from '@/lib/random';
import { convert, parseConversion } from '@/lib/units';
import { NOW } from './helpers';

describe('calculator', () => {
  it.each([
    ['2+2*3', 8], ['(2+2)*3', 12], ['2^10', 1024], ['2**3**2', 512], ['-3^2', -9], ['10 % 3', 1], ['50%', 0.5],
    ['sqrt(16)', 4], ['sqrt 16', 4], ['2pi', 2 * Math.PI], ['3(4+5)', 27], ['(1+2)(3+4)', 21], ['5!', 120],
    ['sin(90deg)', 1], ['log(1000)', 3], ['ln(e)', 1], ['max(3, 9, 4)', 9], ['1e3 + 1', 1001], ['7 × 6 ÷ 2', 21],
  ])('%s = %d', (expr, expected) => {
    expect(evaluate(expr)).toBeCloseTo(expected, 10);
  });

  it('formats without float noise', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
    expect(formatNumber(1e20)).toBe('1e20');
  });

  it('never runs code', () => {
    expect(tryCalculate('alert(1)')).toBeNull();
    expect(tryCalculate('constructor.constructor("return 1")()')).toBeNull();
    expect(() => evaluate('process')).toThrow();
  });

  it.each(['2024-01-15', '555-1234', '1.2.3', '42', '-5', '5%', 'hello', '2 apples', ''])('stays silent for %j', (q) => {
    expect(tryCalculate(q)).toBeNull();
  });
});

describe('units', () => {
  it.each([
    ['10 km to mi', 6.21371192], ['72 f in c', 22.2222222], ['100 c to f', 212], ['3 cups to ml', 709.7647095],
    ['1 mi to ft', 5280], ['2 GiB to MB', 2147.483648], ['1 acre to m2', 4046.8564224], ['60 mph to km/h', 96.56064],
    ['8 oz to g', 226.796185], ['1,500 lbs to kg', 680.388555], ['1 day to hours', 24],
  ])('%s', (q, expected) => {
    expect(parseConversion(q)!.result).toBeCloseTo(expected, 4);
  });

  it('resolves ambiguous aliases by category', () => {
    expect(convert(1, 'c', 'f')!.to.id).toBe('f'); // Celsius, not cups
    expect(convert(2, 'c', 'ml')!.from.id).toBe('cup');
    expect(convert(8, 'oz', 'g')!.from.id).toBe('oz');
    expect(convert(8, 'oz', 'ml')!.from.id).toBe('floz');
  });

  it.each(['10 km to kg', '5 apples to oranges', 'km to mi', 'convert this', '10 km'])('stays silent for %j', (q) => {
    expect(parseConversion(q)).toBeNull();
  });
});

describe('currency', () => {
  it('parses codes, names and symbols', () => {
    expect(parseCurrency('25 usd to eur')).toEqual({ amount: 25, from: 'USD', to: 'EUR' });
    expect(parseCurrency('$1,200 in yen')).toEqual({ amount: 1200, from: 'USD', to: 'JPY' });
    expect(parseCurrency('€40 → gbp')).toEqual({ amount: 40, from: 'EUR', to: 'GBP' });
    expect(parseCurrency('100 euros in dollars')).toEqual({ amount: 100, from: 'EUR', to: 'USD' });
  });
  it.each(['25 usd', 'usd to eur', '10 km to mi', '5 usd to usd', '10 dogecoin to usd'])('stays silent for %j', (q) => {
    expect(parseCurrency(q)).toBeNull();
  });
  it('formats money', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
  });
});

describe('color', () => {
  it('reads six-digit hex as six digits (regression: #ff8800 used to become #FFFF88)', () => {
    expect(toHex(parseColor('#ff8800')!)).toBe('#FF8800');
  });
  it.each([
    ['#f80', '#FF8800'], ['#ff880080', '#FF880080'], ['rgb(30, 144, 255)', '#1E90FF'], ['rgb(30 144 255)', '#1E90FF'],
    ['rgba(0,0,0,0.5)', '#00000080'], ['hsl(0, 100%, 50%)', '#FF0000'], ['hsl(210 80% 50%)', '#1A80E6'],
  ])('%s -> %s', (input, hex) => {
    expect(toHex(parseColor(input)!)).toBe(hex);
  });
  it('converts between formats', () => {
    const c = parseColor('#1e90ff')!;
    expect(formatRgb(c)).toBe('rgb(30, 144, 255)');
    expect(formatHsl(c)).toBe('hsl(210, 100%, 56%)');
  });
  it('computes WCAG contrast', () => {
    expect(contrastRatio(parseColor('#000')!, parseColor('#fff')!)).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColor('#777')!, parseColor('#fff')!)).toBeCloseTo(4.48, 2);
  });
  it('builds a 9-step scale', () => {
    expect(scale(parseColor('#5b5bd6')!)).toHaveLength(9);
  });
  it.each(['#ggg', '#12345', 'ff8800', 'rgb(1,2)', 'red'])('stays silent for %j', (q) => {
    expect(parseColor(q)).toBeNull();
  });
});

describe('hashes and encoders', () => {
  it('matches RFC 1321 MD5 vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('a'.repeat(1000))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });
  it('matches SHA vectors', async () => {
    expect(await digest('sha1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await digest('sha256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect((await digest('sha512', 'abc')).slice(0, 16)).toBe('ddaf35a193617aba');
  });
  it('base64 round-trips unicode', () => {
    expect(base64Encode('héllo 🌙')).toBe('aMOpbGxvIPCfjJk=');
    expect(base64Decode('aMOpbGxvIPCfjJk=')).toBe('héllo 🌙');
    expect(base64Decode('not base64!!')).toBeNull();
  });
});

describe('randomness', () => {
  it('produces in-range integers', () => {
    for (let i = 0; i < 2000; i++) {
      const n = secureInt(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
    }
  });
  it('builds passwords with every character class and clamps length', () => {
    const pw = password(24);
    expect(pw).toHaveLength(24);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[2-9]/);
    expect(pw).toMatch(/[!@#$%^&*\-_=+?]/);
    expect(password(3)).toHaveLength(8);
    expect(password(500)).toHaveLength(128);
    expect(password(20)).not.toBe(password(20));
  });
  it('makes v4 UUIDs', () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('dates', () => {
  const now = new Date(NOW);
  it('parses many date forms', () => {
    expect(parseDate('2026-12-25', now)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDate('12/25/2026', now)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDate('dec 25', now)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDate('25 december 2027', now)).toEqual({ y: 2027, m: 11, d: 25 });
    expect(parseDate('christmas', now)).toEqual({ y: 2026, m: 11, d: 25 });
    expect(parseDate('jan 1', now)).toEqual({ y: 2027, m: 0, d: 1 }); // next occurrence
    expect(parseDate('2026-02-30', now)).toBeNull();
    expect(parseDate('blursday 3', now)).toBeNull();
  });
  it('does date math', () => {
    expect(parseDateQuery('days until christmas', now)).toMatchObject({ kind: 'until', days: 45 });
    expect(parseDateQuery('days since 2026-01-01', now)).toMatchObject({ kind: 'since', days: 313 });
    expect(parseDateQuery('90 days from today', now)).toMatchObject({ kind: 'offset', result: { y: 2027, m: 1, d: 8 } });
    expect(parseDateQuery('2 weeks ago', now)).toMatchObject({ kind: 'offset', result: { y: 2026, m: 9, d: 27 } });
    expect(addToDate({ y: 2026, m: 0, d: 31 }, 1, 'month')).toEqual({ y: 2026, m: 1, d: 28 });
    expect(parseDateQuery('days of our lives', now)).toBeNull();
  });
  it('converts timestamps', () => {
    expect(describeTimestamp(1700000000)!.iso).toBe('2023-11-14T22:13:20.000Z');
    expect(describeTimestamp(1700000000000)!.iso).toBe('2023-11-14T22:13:20.000Z');
  });
  it('parses clock times strictly', () => {
    expect(parseClock('3pm')).toBe(15 * 60);
    expect(parseClock('12am')).toBe(0);
    expect(parseClock('3:30 p.m.')).toBe(15 * 60 + 30);
    expect(parseClock('15:00')).toBe(15 * 60);
    expect(parseClock('3')).toBeNull();
    expect(parseClock('13pm')).toBeNull();
  });
  it('converts between time zones, including the date line', () => {
    expect(zoneOffset('Asia/Tokyo', now)).toBe(540);
    expect(zoneOffset('America/New_York', now)).toBe(-300); // EST in November
    const conv = parseZoneConversion('3pm est in tokyo', now, 'UTC')!;
    expect(conv.result).toBe('5:00 AM');
    expect(conv.dayShift).toBe(1);
    expect(parseZoneConversion('9am in london', now, 'America/Los_Angeles')!.result).toBe('5:00 PM');
    expect(parseZoneConversion('3pm narnia in tokyo', now, 'UTC')).toBeNull();
  });
});
