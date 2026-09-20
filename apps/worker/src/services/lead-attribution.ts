export function normalizeLeadAttribution(input: unknown): Record<string, any> {
  const obj = (v: any): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const token = (v: any) => typeof v === 'string' && v.length <= 96 && /^[\p{L}\p{N} ._~:/+|\-]+$/u.test(v) && !/@/.test(v) && !/(?:\+?\d[ ().-]*){8,}/.test(v) ? v : '';
  const path = (v: any) => typeof v === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(v) && v.length <= 240 ? v : '';
  const touch = (v: any) => {
    const raw = obj(v), utm: Record<string, string> = {};
    for (const key of ['source', 'medium', 'campaign', 'id', 'content', 'term']) {
      const value = token(obj(raw.utm)[key]); if (value) utm[key] = value;
    }
    let referrerOrigin = '';
    try { const url = new URL(raw.referrerOrigin); if (/^https?:$/.test(url.protocol) && !url.username && !url.password && !['flat-travel.com','www.flat-travel.com'].includes(url.hostname)) referrerOrigin = url.origin; } catch {}
    return {utm, referrerOrigin, landingPath: path(raw.landingPath)};
  };
  const raw = obj(input);
  if (raw.schemaVersion !== 'flat-travel-attribution-v1' || raw.status !== 'captured') return {schemaVersion:'flat-travel-attribution-v1', status:'unavailable', reason:raw.reason === 'consent_not_granted' ? raw.reason : 'not_recorded'};
  return {schemaVersion:'flat-travel-attribution-v1',status:'captured',firstTouch:touch(raw.firstTouch),lastTouch:touch(raw.lastTouch),route:(Array.isArray(raw.route) ? raw.route : []).slice(-30).map(path).filter(Boolean)};
}
