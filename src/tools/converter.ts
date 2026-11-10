import { copyAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE } from '@/core/types';
import { formatMoney, parseCurrency, ratesUrl, type CurrencyCode } from '@/lib/currency';
import { formatQuantity, parseConversion } from '@/lib/units';
import { answer } from './_helpers';

// Rates change once a day; keep them for an hour per currency pair.
const rateCache = new Map<string, { rate: number; date: string; at: number }>();
const HOUR = 3_600_000;

export default defineTool({
  id: 'converter',
  name: 'Converter',
  description: 'Units (length, mass, volume, area, speed, data, time, temperature) and currencies.',
  examples: ['10 km to mi', '72 f in c', '3 cups to ml', '2 GiB to MB', '25 usd to eur', '€40 in yen'],
  match(q) {
    const unit = parseConversion(q.text);
    if (unit) {
      const out = formatQuantity(unit.result);
      return answer({
        id: 'unit',
        title: `${formatQuantity(unit.value)} ${unit.from.label} =`,
        answer: `${out} ${unit.to.label}`,
        copy: out.replace(/,/g, ''),
        glyph: 'convert',
      });
    }

    const money = parseCurrency(q.text);
    if (!money) return null;
    const { amount, from, to } = money;
    const key = `${from}:${to}`;
    const show = (rate: number, date: string) => {
      const value = amount * rate;
      return {
        answer: formatMoney(value, to as CurrencyCode),
        subtitle: `1 ${from} = ${rate.toPrecision(6)} ${to} · ECB rate, ${date}`,
        actions: [copyAction(value.toFixed(2))],
      };
    };
    const cached = rateCache.get(key);
    const fresh = cached && Date.now() - cached.at < HOUR;
    return {
      id: 'currency',
      kind: 'answer',
      title: `${formatMoney(amount, from)} in ${to} =`,
      answer: fresh ? show(cached.rate, cached.date).answer : '…',
      subtitle: fresh ? show(cached.rate, cached.date).subtitle : 'Fetching today’s rate',
      icon: { glyph: 'convert' },
      relevance: RELEVANCE.parsed,
      accessory: 'Copy',
      actions: fresh ? show(cached.rate, cached.date).actions : [],
      async hydrate(ctx) {
        if (fresh) return null;
        const data = await ctx.fetchJson<{ date: string; rates: Record<string, number> }>(ratesUrl(from, to));
        const rate = data.rates[to];
        if (!rate) return { answer: 'No rate available', subtitle: undefined };
        rateCache.set(key, { rate, date: data.date, at: Date.now() });
        return show(rate, data.date);
      },
    };
  },
});
