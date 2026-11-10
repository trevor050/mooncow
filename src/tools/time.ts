import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE, type Result } from '@/core/types';
import { formatTimeIn, zoneForPlace } from '@/lib/timezones';

function zoneResult(place: string, zone: string, now: Date): Result {
  const t = formatTimeIn(zone, now);
  return {
    id: `zone:${place.toLowerCase()}`,
    kind: 'answer',
    title: `Time in ${place}`,
    answer: t.time,
    subtitle: `${t.date} · ${t.offset}`,
    icon: { glyph: 'clock' },
    relevance: RELEVANCE.explicit,
    accessory: 'Copy',
    actions: [copyAction(`${t.time} ${t.date} (${place})`)],
  };
}

export default defineTool({
  id: 'time',
  name: 'Time',
  description: 'Local time, or the time in any city.',
  examples: ['time', 'time in tokyo', 'london time', 'what time is it in lagos'],
  match(q, ctx) {
    const now = new Date(ctx.now);
    if (q.is('time', 'now', 'what time is it', 'current time', 'date', 'today', 'what day is it')) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const t = formatTimeIn(zone, now);
      return { ...zoneResult('your time zone', zone, now), id: 'local', title: t.date, answer: t.time, subtitle: `${zone} · ${t.offset}` };
    }
    const place =
      q.commandWithArg('time in', 'what time is it in', 'current time in', 'time at') ??
      q.match(/^(.+?)\s+time$/i)?.[1] ??
      null;
    if (!place) return null;
    const clean = place.replace(/[?.!]+$/, '').trim();
    const zone = zoneForPlace(clean);
    if (zone) return zoneResult(clean, zone, now);
    // "<x> time" is ambiguous ("dinner time"); only "time in <x>" goes to the geocoder.
    if (!q.lower.startsWith('time') && !q.lower.startsWith('what time') && !q.lower.startsWith('current time')) return null;
    if (!/^[\p{L}][\p{L} ,.'-]{1,60}$/u.test(clean)) return null;
    return {
      id: `geo:${clean.toLowerCase()}`,
      kind: 'answer',
      title: `Time in ${clean}`,
      answer: '…',
      icon: { glyph: 'clock' },
      relevance: RELEVANCE.explicit,
      actions: [],
      async hydrate(h) {
        const geo = await h.fetchJson<{ results?: { name: string; timezone?: string; country?: string }[] }>(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(clean)}&count=1&language=en&format=json`,
        );
        const hit = geo.results?.[0];
        if (!hit?.timezone) return { answer: 'Place not found' };
        const r = zoneResult([hit.name, hit.country].filter(Boolean).join(', '), hit.timezone, new Date());
        return { title: r.title, answer: r.answer, subtitle: r.subtitle, accessory: 'Copy', actions: r.actions };
      },
    };
  },
});
