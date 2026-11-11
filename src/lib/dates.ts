// Date math, timestamps and timezone conversion. Pure functions; "now" and
// the local zone are always passed in so tests are deterministic.

import { zoneForPlace } from './timezones';

const DAY = 86_400_000;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthIndex(word: string): number {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  return MONTHS.findIndex((m) => m.startsWith(w));
}

/** Calendar date (no time) in the user's local calendar, as a UTC-midnight timestamp. */
export interface CalendarDate {
  y: number;
  m: number; // 0-11
  d: number;
}

const toUtc = (c: CalendarDate) => Date.UTC(c.y, c.m, c.d);
const fromUtc = (t: number): CalendarDate => {
  const d = new Date(t);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
};
const valid = (c: CalendarDate) => {
  const back = fromUtc(toUtc(c));
  return back.y === c.y && back.m === c.m && back.d === c.d;
};

export function today(now: Date): CalendarDate {
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

function nextOccurrence(m: number, d: number, from: CalendarDate): CalendarDate {
  const thisYear = { y: from.y, m, d };
  return toUtc(thisYear) >= toUtc(from) ? thisYear : { y: from.y + 1, m, d };
}

const HOLIDAYS: Record<string, [number, number]> = {
  christmas: [11, 25], 'christmas eve': [11, 24], xmas: [11, 25], 'new year': [0, 1], "new year's": [0, 1],
  "new year's day": [0, 1], "new year's eve": [11, 31], halloween: [9, 31], "valentine's day": [1, 14],
  valentines: [1, 14], "valentine's": [1, 14], 'independence day': [6, 4], 'july 4th': [6, 4],
};

/** Parse "2026-12-25", "12/25/2026", "dec 25", "december 25, 2027", "25 dec", "christmas", "today", "tomorrow". */
export function parseDate(text: string, now: Date): CalendarDate | null {
  const t = text.trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, ' ').replace(/^the /, '');
  const base = today(now);
  if (t === 'today' || t === 'now') return base;
  if (t === 'tomorrow') return fromUtc(toUtc(base) + DAY);
  if (t === 'yesterday') return fromUtc(toUtc(base) - DAY);
  if (HOLIDAYS[t]) return nextOccurrence(HOLIDAYS[t][0], HOLIDAYS[t][1], base);

  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const c = { y: +m[1], m: +m[2] - 1, d: +m[3] };
    return valid(c) ? c : null;
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const c = { y: +m[3], m: +m[1] - 1, d: +m[2] };
    return valid(c) ? c : null;
  }
  m = t.match(/^([a-z.]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/) || null;
  if (m) {
    const mi = monthIndex(m[1]);
    if (mi < 0) return null;
    const c = m[3] ? { y: +m[3], m: mi, d: +m[2] } : nextOccurrence(mi, +m[2], base);
    return valid(c) ? c : null;
  }
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z.]+)(?: (\d{4}))?$/);
  if (m) {
    const mi = monthIndex(m[2]);
    if (mi < 0) return null;
    const c = m[3] ? { y: +m[3], m: mi, d: +m[1] } : nextOccurrence(mi, +m[1], base);
    return valid(c) ? c : null;
  }
  return null;
}

export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY);
}

export function formatDate(c: CalendarDate): string {
  return new Date(toUtc(c)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function isoDate(c: CalendarDate): string {
  return `${c.y}-${String(c.m + 1).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

const UNIT_DAYS: Record<string, number> = { day: 1, days: 1, d: 1, week: 7, weeks: 7, w: 7 };

export function addToDate(c: CalendarDate, amount: number, unit: string): CalendarDate | null {
  const u = unit.toLowerCase();
  if (UNIT_DAYS[u]) return fromUtc(toUtc(c) + amount * UNIT_DAYS[u] * DAY);
  if (/^(months?|mo)$/.test(u) || /^(years?|yrs?|y)$/.test(u)) {
    const months = /^(years?|yrs?|y)$/.test(u) ? amount * 12 : amount;
    const total = c.m + months;
    const y = c.y + Math.floor(total / 12);
    const mIdx = ((total % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(y, mIdx + 1, 0)).getUTCDate();
    return { y, m: mIdx, d: Math.min(c.d, lastDay) };
  }
  return null;
}

export type DateQuery =
  | { kind: 'until'; target: CalendarDate; days: number }
  | { kind: 'since'; target: CalendarDate; days: number }
  | { kind: 'between'; from: CalendarDate; to: CalendarDate; days: number }
  | { kind: 'offset'; result: CalendarDate; description: string };

export function parseDateQuery(text: string, now: Date): DateQuery | null {
  const t = text.trim().toLowerCase().replace(/\?$/, '');
  const base = today(now);
  let m = t.match(/^(?:how many )?days (until|till|til|to|before) (.+)$/);
  if (m) {
    const target = parseDate(m[2], now);
    return target ? { kind: 'until', target, days: daysBetween(base, target) } : null;
  }
  m = t.match(/^(?:how many )?days (since|after|from) (.+)$/);
  if (m && !/^(today|now)$/.test(m[2])) {
    const target = parseDate(m[2], now);
    return target ? { kind: 'since', target, days: daysBetween(target, base) } : null;
  }
  m = t.match(/^(?:days )?between (.+) and (.+)$/);
  if (m) {
    const from = parseDate(m[1], now);
    const to = parseDate(m[2], now);
    return from && to ? { kind: 'between', from, to, days: daysBetween(from, to) } : null;
  }
  m = t.match(/^(\d{1,4}) (days?|weeks?|months?|years?) (from|after|ago|before)(?: (.+))?$/);
  if (m) {
    const n = +m[1];
    const dir = m[3] === 'ago' || m[3] === 'before' ? -1 : 1;
    if (m[3] === 'ago' && m[4]) return null;
    const anchor = m[4] ? parseDate(m[4], now) : base;
    if (!anchor) return null;
    const result = addToDate(anchor, dir * n, m[2]);
    return result ? { kind: 'offset', result, description: `${m[1]} ${m[2]} ${m[3]}${m[4] ? ' ' + m[4] : ''}` } : null;
  }
  m = t.match(/^(?:in|date in) (\d{1,4}) (days?|weeks?|months?|years?)$/);
  if (m) {
    const result = addToDate(base, +m[1], m[2]);
    return result ? { kind: 'offset', result, description: `in ${m[1]} ${m[2]}` } : null;
  }
  return null;
}

// ------------------------------------------------------------- timestamps

export function describeTimestamp(value: number): { ms: number; iso: string; local: string } | null {
  // 10 digits = seconds, 13 = milliseconds.
  const ms = value < 1e11 ? value * 1000 : value;
  if (!Number.isFinite(ms) || ms < 0 || ms > 8.64e15) return null;
  const d = new Date(ms);
  return { ms, iso: d.toISOString(), local: d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' }) };
}

// ------------------------------------------------------- timezone conversion

/** Offset of `zone` from UTC in minutes at instant `at`. */
export function zoneOffset(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Parse "3pm", "3:30 pm", "15:00", "noon", "midnight" into minutes after midnight. */
export function parseClock(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\./g, '');
  if (t === 'noon') return 12 * 60;
  if (t === 'midnight') return 0;
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    if (m[3].startsWith('p') && h !== 12) h += 12;
    if (m[3].startsWith('a') && h === 12) h = 0;
  } else if (!m[2] || h > 23) {
    return null; // a bare "3" is not a time
  }
  return h * 60 + min;
}

export interface ZoneConversion {
  fromZone: string;
  toZone: string;
  fromLabel: string;
  toLabel: string;
  result: string;
  dayShift: number;
}

/** "3pm est in tokyo", "15:00 london to new york", "noon pst in ist" */
export function parseZoneConversion(text: string, now: Date, localZone: string): ZoneConversion | null {
  const m = text.trim().toLowerCase().match(/^(.+?(?:am|pm|a\.m\.|p\.m\.|noon|midnight|\d:\d\d))\s+(?:in\s+)?(.*?)\s*(?:to|in|->|→)\s+(.+)$/);
  if (!m) return null;
  const minutes = parseClock(m[1]);
  if (minutes === null) return null;
  const fromPlace = m[2].trim();
  const fromZone = fromPlace ? zoneForPlace(fromPlace) : localZone;
  const toZone = zoneForPlace(m[3]);
  if (!fromZone || !toZone) return null;
  // Build the instant: that wall-clock time today in the source zone.
  const t = today(now);
  const guess = Date.UTC(t.y, t.m, t.d, Math.floor(minutes / 60), minutes % 60);
  const instant = new Date(guess - zoneOffset(fromZone, new Date(guess)) * 60_000);
  const fmt = (zone: string) => new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(instant);
  const dayOf = (zone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(instant);
  const dayShift = Math.round((Date.parse(dayOf(toZone)) - Date.parse(dayOf(fromZone))) / DAY);
  return {
    fromZone,
    toZone,
    fromLabel: fromPlace || 'local',
    toLabel: m[3].trim(),
    result: fmt(toZone),
    dayShift,
  };
}
