// Color parsing and conversion for the color tool.

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function parseHex(input: string): Rgba | null {
  // Longest forms first so "#ff8800" is never read as "#ff8".
  const m = input.trim().match(/^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length <= 4) hex = hex.split('').map((c) => c + c).join('');
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? Math.round((n(6) / 255) * 1000) / 1000 : 1 };
}

const num = String.raw`\s*(-?\d*\.?\d+)(%?)\s*`;
const SEP = String.raw`(?:,|\s)`;
const RGB_RE = new RegExp(String.raw`^rgba?\(${num}${SEP}${num}${SEP}${num}(?:[,/]${num})?\)$`, 'i');
const HSL_RE = new RegExp(String.raw`^hsla?\(${num}(?:deg)?${SEP}${num}${SEP}${num}(?:[,/]${num})?\)$`, 'i');

function alpha(value?: string, pct?: string): number {
  if (value === undefined) return 1;
  const v = parseFloat(value);
  return clamp(pct ? v / 100 : v, 0, 1);
}

export function parseColor(input: string): Rgba | null {
  const text = input.trim();
  const hex = text.startsWith('#') ? parseHex(text) : null;
  if (hex) return hex;
  let m = text.match(RGB_RE);
  if (m) {
    const ch = (v: string, p: string) => clamp(Math.round(p ? (parseFloat(v) / 100) * 255 : parseFloat(v)), 0, 255);
    return { r: ch(m[1], m[2]), g: ch(m[3], m[4]), b: ch(m[5], m[6]), a: alpha(m[7], m[8]) };
  }
  m = text.match(HSL_RE);
  if (m) {
    const { r, g, b } = hslToRgb(parseFloat(m[1]), parseFloat(m[3]), parseFloat(m[5]));
    return { r, g, b, a: alpha(m[7], m[8]) };
  }
  return null;
}

export function toHex({ r, g, b, a }: Rgba): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`.toUpperCase();
}

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function formatRgb({ r, g, b, a }: Rgba): string {
  return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl({ r, g, b, a }: Rgba): string {
  const { h, s, l } = rgbToHsl(r, g, b);
  return a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`;
}

/** WCAG relative luminance, used to pick readable text on a swatch. */
export function luminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Tints and shades around a color, lightest first. */
export function scale(color: Rgba, steps = 9): string[] {
  const { h, s } = rgbToHsl(color.r, color.g, color.b);
  return Array.from({ length: steps }, (_, i) => {
    const l = 95 - (i * 85) / (steps - 1);
    const { r, g, b } = hslToRgb(h, s, l);
    return toHex({ r, g, b, a: 1 });
  });
}
