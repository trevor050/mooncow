// Currency parsing is pure; rates come from Frankfurter (ECB reference rates,
// no key) via the converter tool's hydrate step.

const CODES = [
  'AUD', 'BGN', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR',
  'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
] as const;
export type CurrencyCode = (typeof CODES)[number];

const NAMES: Record<string, CurrencyCode> = {
  $: 'USD', usd: 'USD', dollar: 'USD', dollars: 'USD', 'us dollars': 'USD', bucks: 'USD',
  '€': 'EUR', eur: 'EUR', euro: 'EUR', euros: 'EUR',
  '£': 'GBP', gbp: 'GBP', pound: 'GBP', pounds: 'GBP', quid: 'GBP', sterling: 'GBP',
  '¥': 'JPY', jpy: 'JPY', yen: 'JPY',
  '₹': 'INR', inr: 'INR', rupee: 'INR', rupees: 'INR',
  '₩': 'KRW', krw: 'KRW', won: 'KRW',
  cad: 'CAD', 'canadian dollars': 'CAD', aud: 'AUD', 'australian dollars': 'AUD',
  chf: 'CHF', franc: 'CHF', francs: 'CHF', yuan: 'CNY', rmb: 'CNY', cny: 'CNY',
  peso: 'MXN', pesos: 'MXN', mxn: 'MXN', real: 'BRL', reais: 'BRL', brl: 'BRL',
};

export function currencyCode(token: string): CurrencyCode | null {
  const t = token.trim().toLowerCase();
  if (NAMES[t]) return NAMES[t];
  const upper = t.toUpperCase();
  return (CODES as readonly string[]).includes(upper) ? (upper as CurrencyCode) : null;
}

export interface CurrencyQuery {
  amount: number;
  from: CurrencyCode;
  to: CurrencyCode;
}

// "10 usd to eur", "$25 in yen", "€5 → gbp", "100 euros in dollars"
const PATTERN = /^([$€£¥₹₩])?\s*([\d,]*\.?\d+)\s*([a-z][a-z ]*?|[$€£¥₹₩])?\s+(?:to|in|into|as|->|→)\s+([a-z][a-z ]*|[$€£¥₹₩])$/i;

export function parseCurrency(text: string): CurrencyQuery | null {
  const m = text.trim().match(PATTERN);
  if (!m) return null;
  const [, symbol, rawAmount, fromWord, toWord] = m;
  if (symbol && fromWord) return null;
  const fromToken = symbol || fromWord;
  if (!fromToken) return null;
  const from = currencyCode(fromToken);
  const to = currencyCode(toWord);
  if (!from || !to || from === to) return null;
  const amount = parseFloat(rawAmount.replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  return { amount, from, to };
}

export function formatMoney(amount: number, code: CurrencyCode): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: amount < 1 ? 4 : 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function ratesUrl(from: CurrencyCode, to: CurrencyCode): string {
  return `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`;
}
