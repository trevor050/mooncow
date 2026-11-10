import { copyAction, openAction } from '@/core/actions';
import { defineTool } from '@/core/registry';
import { RELEVANCE } from '@/core/types';

// Current conditions from Open-Meteo (keyless). The city is geocoded first.

const WMO: Record<number, string> = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};

export function describeWeatherCode(code: number): string {
  return WMO[code] ?? 'Unknown';
}

/** Fahrenheit for the few countries that use it, Celsius elsewhere. */
export function prefersFahrenheit(countryCode?: string): boolean {
  return ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW', 'FM', 'MH'].includes((countryCode || '').toUpperCase());
}

interface GeoResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
}

export function parseWeatherQuery(q: { commandWithArg(...t: string[]): string | null; match(re: RegExp): RegExpMatchArray | null }): string | null {
  const place =
    q.commandWithArg('weather in', 'weather for', 'weather', 'forecast for', 'forecast in', 'forecast', 'temperature in', 'temp in') ??
    q.match(/^(.+?)\s+(?:weather|forecast)$/i)?.[1] ??
    null;
  if (!place) return null;
  const clean = place.replace(/[?.!]+$/, '').trim();
  return /^[\p{L}][\p{L} ,.'-]{1,60}$/u.test(clean) ? clean : null;
}

export default defineTool({
  id: 'weather',
  name: 'Weather',
  description: 'Current conditions for any city, from Open-Meteo.',
  examples: ['weather tokyo', 'boston weather', 'forecast for lisbon'],
  match(q) {
    if (q.is('weather', 'forecast')) {
      return {
        id: 'hint',
        kind: 'command',
        title: 'Weather for a city',
        subtitle: 'Type a city name, like “weather tokyo”',
        icon: { glyph: 'cloud' },
        relevance: RELEVANCE.explicit,
        actions: [{ title: 'Type a city', run: (ctx) => ctx.setQuery('weather ') }],
      };
    }
    const place = parseWeatherQuery(q);
    if (!place) return null;
    const search = openAction(`https://www.google.com/search?q=${encodeURIComponent(`weather ${place}`)}`, 'Search the web');
    return {
      id: `weather:${place.toLowerCase()}`,
      kind: 'answer',
      title: `Weather in ${place}`,
      answer: '…',
      icon: { glyph: 'cloud' },
      relevance: RELEVANCE.explicit,
      actions: [search],
      async hydrate(ctx) {
        const geo = await ctx.fetchJson<{ results?: GeoResult[] }>(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`,
        );
        const loc = geo.results?.[0];
        if (!loc) return { answer: 'Place not found', actions: [search] };
        const f = prefersFahrenheit(loc.country_code);
        const unit = f ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
        const wx = await ctx.fetchJson<{
          current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number; relative_humidity_2m: number };
          daily: { temperature_2m_max: number[]; temperature_2m_min: number[] };
        }>(
          `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
            `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
            `&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto${unit}`,
        );
        const deg = f ? '°F' : '°C';
        const c = wx.current;
        const summary = `${Math.round(c.temperature_2m)}${deg} · ${describeWeatherCode(c.weather_code)}`;
        const where = [loc.name, loc.admin1, loc.country].filter(Boolean).join(', ');
        return {
          title: where,
          answer: summary,
          subtitle: `Feels like ${Math.round(c.apparent_temperature)}${deg} · H ${Math.round(wx.daily.temperature_2m_max[0])}${deg} L ${Math.round(wx.daily.temperature_2m_min[0])}${deg} · wind ${Math.round(c.wind_speed_10m)} ${f ? 'mph' : 'km/h'} · humidity ${c.relative_humidity_2m}%`,
          accessory: 'Copy',
          actions: [copyAction(`${where}: ${summary}`), search],
        };
      },
    };
  },
});
