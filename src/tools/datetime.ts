import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE } from '@/core/types';
import { describeTimestamp, formatDate, isoDate, parseDateQuery, parseZoneConversion } from '@/lib/dates';
import { answer } from './_helpers';

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${Math.abs(n) === 1 ? '' : 's'}`;

export default defineTool({
  id: 'datetime',
  name: 'Dates and timestamps',
  description: 'Date math, Unix timestamps, and converting a time between zones.',
  examples: ['days until christmas', 'days since 2020-03-11', '90 days from today', '3pm est in tokyo', 'unix 1700000000', 'timestamp'],
  match(q, ctx) {
    const now = new Date(ctx.now);

    const dq = parseDateQuery(q.text, now);
    if (dq) {
      if (dq.kind === 'until') {
        return answer({ id: 'until', title: `Days until ${formatDate(dq.target)}`, answer: dq.days >= 0 ? plural(dq.days, 'day') : `${plural(-dq.days, 'day')} ago`, copy: String(dq.days), glyph: 'clock', relevance: RELEVANCE.explicit });
      }
      if (dq.kind === 'since') {
        return answer({ id: 'since', title: `Days since ${formatDate(dq.target)}`, answer: plural(dq.days, 'day'), copy: String(dq.days), glyph: 'clock', relevance: RELEVANCE.explicit });
      }
      if (dq.kind === 'between') {
        return answer({ id: 'between', title: `${isoDate(dq.from)} → ${isoDate(dq.to)}`, answer: plural(Math.abs(dq.days), 'day'), copy: String(Math.abs(dq.days)), glyph: 'clock', relevance: RELEVANCE.explicit });
      }
      return answer({ id: 'offset', title: dq.description, answer: formatDate(dq.result), copy: isoDate(dq.result), glyph: 'clock', relevance: RELEVANCE.explicit });
    }

    const zone = parseZoneConversion(q.text, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (zone) {
      const shift = zone.dayShift === 1 ? ' (next day)' : zone.dayShift === -1 ? ' (previous day)' : '';
      return answer({ id: 'zone', title: `${q.text.split(/\s+(?:to|in|->|→)\s+/i)[0]} in ${zone.toLabel}`, answer: zone.result + shift, subtitle: zone.toZone, glyph: 'clock', relevance: RELEVANCE.explicit });
    }

    if (q.is('timestamp', 'unix', 'unix time', 'unix timestamp', 'epoch', 'now unix')) {
      const secs = Math.floor(ctx.now / 1000);
      return { ...answer({ id: 'now', title: 'Current Unix timestamp', answer: String(secs), subtitle: `${ctx.now} ms`, glyph: 'clock', relevance: RELEVANCE.explicit }), actions: [copyAction(String(secs), 'Copy seconds'), copyAction(String(ctx.now), 'Copy milliseconds')] };
    }
    const explicitTs = q.commandWithArg('unix', 'epoch', 'timestamp', 'ts');
    const bare = q.match(/^(\d{10}|\d{13})$/)?.[1];
    const raw = explicitTs && /^\d{9,13}$/.test(explicitTs) ? explicitTs : bare;
    if (raw) {
      const ts = describeTimestamp(Number(raw));
      if (!ts) return null;
      // A bare 10-digit number may be a phone number, so it stays below web search.
      const relevance = explicitTs ? RELEVANCE.explicit : RELEVANCE.partial;
      return { ...answer({ id: 'ts', title: `Unix ${raw.length === 13 ? 'ms' : 'seconds'} ${raw}`, answer: ts.local, subtitle: ts.iso, glyph: 'clock', relevance }), actions: [copyAction(ts.iso, 'Copy ISO 8601'), copyAction(ts.local, 'Copy local time')] };
    }
    return null;
  },
});
