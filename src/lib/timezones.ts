// "time in tokyo": a small built-in city table answers instantly; anything else
// is looked up through Open-Meteo's geocoder, which returns an IANA zone.

const CITIES: Record<string, string> = {
  'new york': 'America/New_York', nyc: 'America/New_York', boston: 'America/New_York', miami: 'America/New_York',
  washington: 'America/New_York', toronto: 'America/Toronto', atlanta: 'America/New_York',
  chicago: 'America/Chicago', houston: 'America/Chicago', dallas: 'America/Chicago', austin: 'America/Chicago',
  denver: 'America/Denver', phoenix: 'America/Phoenix',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles', vancouver: 'America/Vancouver', honolulu: 'Pacific/Honolulu', anchorage: 'America/Anchorage',
  'mexico city': 'America/Mexico_City', 'sao paulo': 'America/Sao_Paulo', 'buenos aires': 'America/Argentina/Buenos_Aires',
  london: 'Europe/London', dublin: 'Europe/Dublin', lisbon: 'Europe/Lisbon', paris: 'Europe/Paris', berlin: 'Europe/Berlin',
  madrid: 'Europe/Madrid', rome: 'Europe/Rome', amsterdam: 'Europe/Amsterdam', stockholm: 'Europe/Stockholm',
  zurich: 'Europe/Zurich', vienna: 'Europe/Vienna', warsaw: 'Europe/Warsaw', athens: 'Europe/Athens', kyiv: 'Europe/Kyiv',
  istanbul: 'Europe/Istanbul', moscow: 'Europe/Moscow', cairo: 'Africa/Cairo', lagos: 'Africa/Lagos', nairobi: 'Africa/Nairobi',
  johannesburg: 'Africa/Johannesburg', dubai: 'Asia/Dubai', karachi: 'Asia/Karachi', mumbai: 'Asia/Kolkata', delhi: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata', dhaka: 'Asia/Dhaka', bangkok: 'Asia/Bangkok', jakarta: 'Asia/Jakarta', singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong', shanghai: 'Asia/Shanghai', beijing: 'Asia/Shanghai', taipei: 'Asia/Taipei', manila: 'Asia/Manila',
  seoul: 'Asia/Seoul', tokyo: 'Asia/Tokyo', osaka: 'Asia/Tokyo', sydney: 'Australia/Sydney', melbourne: 'Australia/Melbourne',
  brisbane: 'Australia/Brisbane', perth: 'Australia/Perth', auckland: 'Pacific/Auckland',
  utc: 'UTC', gmt: 'UTC', est: 'America/New_York', pst: 'America/Los_Angeles', cst: 'America/Chicago', mst: 'America/Denver',
  cet: 'Europe/Paris', ist: 'Asia/Kolkata', jst: 'Asia/Tokyo',
};

export function zoneForPlace(place: string): string | null {
  return CITIES[place.trim().toLowerCase().replace(/[.?!]+$/, '')] || null;
}

export function formatTimeIn(zone: string, date = new Date()): { time: string; date: string; offset: string } {
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(date);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long', month: 'short', day: 'numeric' }).format(date);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
    .formatToParts(date).find((p) => p.type === 'timeZoneName')?.value || '';
  return { time, date: day, offset };
}
