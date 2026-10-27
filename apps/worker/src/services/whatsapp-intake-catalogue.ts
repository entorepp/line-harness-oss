import type { Candidate, CatalogueItem, IntakeState, Locale } from './whatsapp-intake.js';

const ORIGIN = 'https://flat-travel.com';
const text = (v: unknown, limit = 180) => typeof v === 'string' && v.trim() && v.length <= limit ? v.trim() : '';
async function publicData(tour?: string, deadline = Date.now() + 8000): Promise<any> {
  const url = new URL('/__journey-data-v1', ORIGIN);
  if (tour) url.searchParams.set('tour', tour);
  url.searchParams.set('wa_catalogue', String(Math.floor(Date.now() / 300000)));
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, redirect: 'error', signal: AbortSignal.timeout(Math.max(1, Math.min(4000, deadline - Date.now()))) });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('intake_catalogue_unavailable');
  // Stream-bound the public response before parsing; do not trust Content-Length.
  const reader = response.body?.getReader(); if (!reader) throw new Error('intake_catalogue_unavailable');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new Error('intake_catalogue_oversized'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  const time = Date.parse(data.fetchedAt);
  if (data.dataset !== 'production' || !/^Sanity published runtime Journey (?:discovery )?data$/.test(data.source || '') || !Array.isArray(data.tours) || data.tours.length > 30 ||
    !Number.isFinite(time) || time > Date.now() + 60000 || time < Date.now() - 24 * 3600000) throw new Error('intake_catalogue_unverified');
  return data;
}

export function projectJourneys(data: any, locale: Locale): CatalogueItem[] {
  const validUntil = new Date(Date.now() + 5 * 60000).toISOString();
  return data.tours.flatMap((t: any) => {
    if (!/^C\d{2}(?:-[A-Z0-9]+)?$/.test(t.id || '') || !Number.isInteger(t.days) || !text(t.title) || !Array.isArray(t.cities) || !t.cities.every((c: unknown) => text(c, 60))) return [];
    const cities = [...new Set(t.cities)] as string[];
    if (!Array.isArray(t.supportedPartySizes) || !t.supportedPartySizes.every((n: unknown) => Number.isInteger(n) && Number(n) > 0 && Number(n) <= 20)) return [];
    if (t.readyLocales && !t.readyLocales.includes(locale)) return [];
    return [{ id: t.id, title: t.title, kind: 'package', locale, url: `${ORIGIN}/${locale}/journeys/${t.id.toLowerCase()}`,
      publication: { status: 'published', revision: `snapshot@${data.fetchedAt}`, validUntil }, cities, minDays: t.days, maxDays: t.days,
      supportedPartySizes: t.supportedPartySizes, supportEvidence: {}, discoveryOnly: true } satisfies CatalogueItem];
  });
}

export function projectHotels(data: any, city: string, locale: Locale): CatalogueItem[] {
  const result: CatalogueItem[] = []; const seen = new Set<string>();
  for (const tour of data.tours) for (const stay of tour.stays || []) {
    if (!Array.isArray(stay) || stay[1] !== city || !Array.isArray(stay[5])) continue;
    for (const h of stay[5]) {
      if (h.candidateScope !== 'journey' || h.source !== 'sanity-linked' || !text(h.hotelId, 120) || !text(h.name) ||
        !/^\/en\/accessible-hotels\/[a-z0-9-]+$/.test(h.path || '') || seen.has(h.hotelId)) continue;
      seen.add(h.hotelId);
      result.push({ id: h.hotelId, title: h.name, kind: 'hotel', locale, url: `${ORIGIN}${h.path.replace(/^\/en\//, `/${locale}/`)}`,
        publication: { status: 'published', revision: `snapshot@${data.fetchedAt}`, validUntil: new Date(Date.now() + 300000).toISOString() },
        cities: [city], minDays: 1, maxDays: 181, supportEvidence: {}, discoveryOnly: true });
    }
  }
  return result;
}

/** No price/provider fields from public data enter candidates or the model. */
export async function loadIntakeCatalogue(s: IntakeState, deadline = Date.now() + 8000): Promise<CatalogueItem[]> {
  const data = await publicData(undefined, deadline); const journeys = projectJourneys(data, s.locale);
  if (s.slots.preference === 'package' || s.slots.cities?.length !== 1) return journeys;
  const city = s.slots.cities[0]; const source = journeys.find(p => p.cities.includes(city));
  if (!source) return s.slots.preference === 'either' ? journeys : [];
  const detail = await publicData(source.id, deadline); const hotels = projectHotels(detail, city, s.locale);
  return s.slots.preference === 'hotel' ? hotels : [...journeys, ...hotels];
}

/** Validate the actual localized public route and take its title, without reading the whole page. */
export async function verifyIntakeCandidateTitles(candidates: Candidate[], locale: Locale, deadline: number): Promise<Map<string, string>> {
  const languages: Record<Locale, string[]> = { en: ['en'], tc: ['zh-Hant', 'zh-TW'], sc: ['zh-Hans', 'zh-CN'], kr: ['ko', 'ko-KR'] };
  const entries = await Promise.all(candidates.map(async candidate => {
    const url = new URL(candidate.url);
    if (url.origin !== ORIGIN || !url.pathname.startsWith(`/${locale}/`) || url.search || url.hash) throw new Error('intake_public_route_invalid');
    const response = await fetch(url, { redirect: 'error', headers: { Accept: 'text/html' }, signal: AbortSignal.timeout(Math.max(1, Math.min(4000, deadline - Date.now()))) });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('intake_public_route_unavailable');
    const reader = response.body?.getReader(); if (!reader) throw new Error('intake_public_route_unavailable');
    let html = ''; let size = 0; const decoder = new TextDecoder();
    try {
      while (size < 160000) {
        const part = await reader.read(); if (part.done) break; size += part.value.length; html += decoder.decode(part.value, { stream: true });
        if (/<\/title>/i.test(html)) break;
      }
    } finally { await reader.cancel(); }
    const language = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i)?.[1];
    const title = html.match(/<title\b[^>]*>([^<]+)<\/title>/i)?.[1];
    if (!language || !languages[locale].some(v => language.toLowerCase() === v.toLowerCase()) || !title || title.length > 400) throw new Error('intake_public_locale_unverified');
    const decoded = title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '').replace(/&#x([a-f0-9]+);/gi, (_, n) => Number.parseInt(n, 16) <= 0x10ffff ? String.fromCodePoint(Number.parseInt(n, 16)) : '');
    return [candidate.id, decoded.replace(/\s*\|\s*Flat Travel\s*$/i, '').trim()] as const;
  }));
  return new Map(entries);
}
