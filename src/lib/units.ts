// Unit conversion. Each unit has a factor to its category's base unit
// (temperature uses offset functions instead). Aliases may be ambiguous across
// categories ("c" is Celsius or cup, "m" is metre or minute); conversion picks
// the pair of units that share a category.

type Category = 'length' | 'mass' | 'volume' | 'area' | 'speed' | 'data' | 'time' | 'temperature';

interface Unit {
  id: string;
  category: Category;
  label: string;
  aliases: string[];
  factor?: number;
  toBase?: (v: number) => number;
  fromBase?: (v: number) => number;
}

const U = (id: string, category: Category, label: string, factor: number, aliases: string[]): Unit => ({
  id, category, label, factor, aliases: [id, ...aliases],
});

const UNITS: Unit[] = [
  // length (metre)
  U('mm', 'length', 'mm', 0.001, ['millimeter', 'millimeters', 'millimetre', 'millimetres']),
  U('cm', 'length', 'cm', 0.01, ['centimeter', 'centimeters', 'centimetre', 'centimetres']),
  U('m', 'length', 'm', 1, ['meter', 'meters', 'metre', 'metres']),
  U('km', 'length', 'km', 1000, ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms']),
  U('in', 'length', 'in', 0.0254, ['inch', 'inches', '"']),
  U('ft', 'length', 'ft', 0.3048, ['foot', 'feet', "'"]),
  U('yd', 'length', 'yd', 0.9144, ['yard', 'yards']),
  U('mi', 'length', 'mi', 1609.344, ['mile', 'miles']),
  U('nmi', 'length', 'nmi', 1852, ['nautical mile', 'nautical miles']),
  // mass (kilogram)
  U('mg', 'mass', 'mg', 1e-6, ['milligram', 'milligrams']),
  U('g', 'mass', 'g', 0.001, ['gram', 'grams', 'gr']),
  U('kg', 'mass', 'kg', 1, ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs']),
  U('t', 'mass', 't', 1000, ['tonne', 'tonnes', 'metric ton', 'metric tons']),
  U('oz', 'mass', 'oz', 0.028349523125, ['ounce', 'ounces']),
  U('lb', 'mass', 'lb', 0.45359237, ['lbs', 'pound', 'pounds']),
  U('st', 'mass', 'st', 6.35029318, ['stone', 'stones']),
  // volume (litre)
  U('ml', 'volume', 'mL', 0.001, ['milliliter', 'milliliters', 'millilitre', 'millilitres']),
  U('l', 'volume', 'L', 1, ['liter', 'liters', 'litre', 'litres']),
  U('tsp', 'volume', 'tsp', 0.00492892159375, ['teaspoon', 'teaspoons']),
  U('tbsp', 'volume', 'tbsp', 0.01478676478125, ['tablespoon', 'tablespoons']),
  U('floz', 'volume', 'fl oz', 0.0295735295625, ['fl oz', 'fluid ounce', 'fluid ounces', 'oz']),
  U('cup', 'volume', 'cups', 0.2365882365, ['cups', 'c']),
  U('pt', 'volume', 'pt', 0.473176473, ['pint', 'pints']),
  U('qt', 'volume', 'qt', 0.946352946, ['quart', 'quarts']),
  U('gal', 'volume', 'gal', 3.785411784, ['gallon', 'gallons']),
  // area (square metre)
  U('m2', 'area', 'm²', 1, ['m²', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres']),
  U('km2', 'area', 'km²', 1e6, ['km²', 'sq km', 'square kilometer', 'square kilometers']),
  U('ft2', 'area', 'ft²', 0.09290304, ['ft²', 'sq ft', 'square foot', 'square feet']),
  U('acre', 'area', 'acres', 4046.8564224, ['acres', 'ac']),
  U('ha', 'area', 'ha', 10000, ['hectare', 'hectares']),
  // speed (metre per second)
  U('mps', 'speed', 'm/s', 1, ['m/s', 'meters per second']),
  U('kph', 'speed', 'km/h', 1 / 3.6, ['km/h', 'kmh', 'kmph', 'kilometers per hour']),
  U('mph', 'speed', 'mph', 0.44704, ['miles per hour']),
  U('knot', 'speed', 'kn', 0.514444, ['knots', 'kn', 'kt']),
  // data (byte)
  U('b', 'data', 'B', 1, ['byte', 'bytes']),
  U('kb', 'data', 'KB', 1e3, ['kilobyte', 'kilobytes']),
  U('mb', 'data', 'MB', 1e6, ['megabyte', 'megabytes']),
  U('gb', 'data', 'GB', 1e9, ['gigabyte', 'gigabytes']),
  U('tb', 'data', 'TB', 1e12, ['terabyte', 'terabytes']),
  U('kib', 'data', 'KiB', 1024, ['kibibyte', 'kibibytes']),
  U('mib', 'data', 'MiB', 1024 ** 2, ['mebibyte', 'mebibytes']),
  U('gib', 'data', 'GiB', 1024 ** 3, ['gibibyte', 'gibibytes']),
  // time (second)
  U('ms', 'time', 'ms', 0.001, ['millisecond', 'milliseconds']),
  U('s', 'time', 's', 1, ['sec', 'secs', 'second', 'seconds']),
  U('min', 'time', 'min', 60, ['mins', 'minute', 'minutes']),
  U('h', 'time', 'h', 3600, ['hr', 'hrs', 'hour', 'hours']),
  U('d', 'time', 'days', 86400, ['day', 'days']),
  U('wk', 'time', 'weeks', 604800, ['week', 'weeks']),
  U('yr', 'time', 'years', 31557600, ['year', 'years']),
  // temperature (kelvin)
  { id: 'c', category: 'temperature', label: '°C', aliases: ['c', '°c', 'celsius', 'centigrade'], toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15 },
  { id: 'f', category: 'temperature', label: '°F', aliases: ['f', '°f', 'fahrenheit'], toBase: (v) => (v - 32) * 5 / 9 + 273.15, fromBase: (v) => (v - 273.15) * 9 / 5 + 32 },
  { id: 'k', category: 'temperature', label: 'K', aliases: ['k', 'kelvin'], toBase: (v) => v, fromBase: (v) => v },
];

const BY_ALIAS = new Map<string, Unit[]>();
for (const unit of UNITS) {
  for (const alias of unit.aliases) {
    const key = alias.toLowerCase();
    BY_ALIAS.set(key, [...(BY_ALIAS.get(key) || []), unit]);
  }
}

export function findUnits(token: string): Unit[] {
  return BY_ALIAS.get(token.trim().toLowerCase()) || [];
}

function toBase(unit: Unit, v: number): number {
  return unit.toBase ? unit.toBase(v) : v * unit.factor!;
}

function fromBase(unit: Unit, v: number): number {
  return unit.fromBase ? unit.fromBase(v) : v / unit.factor!;
}

export interface Conversion {
  value: number;
  from: Unit;
  to: Unit;
  result: number;
}

export function convert(value: number, fromToken: string, toToken: string): Conversion | null {
  const froms = findUnits(fromToken);
  const tos = findUnits(toToken);
  for (const from of froms) {
    const to = tos.find((t) => t.category === from.category);
    if (to && to !== from) return { value, from, to, result: fromBase(to, toBase(from, value)) };
  }
  return null;
}

// "10 km to mi", "5'11 in cm" is out of scope; "72 f in c", "3.5 cups to ml", "1,500 lbs → kg"
const PATTERN = /^(-?[\d,]*\.?\d+)\s*([a-z°'"²/][a-z0-9°'"²/ ]*?)\s+(?:to|in|into|as|->|→|=)\s+([a-z°'"²/][a-z0-9°'"²/ ]*)$/i;

export function parseConversion(text: string): Conversion | null {
  const m = text.trim().match(PATTERN);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return convert(value, m[2], m[3]);
}

export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-4)) return n.toExponential(4).replace(/\.?0+e/, 'e');
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6;
  return Number(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits });
}
