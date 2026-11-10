export function normalizeLeadAttribution(input: unknown): Record<string, any> {
  const obj = (v: any): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const token = (v: any) => typeof v === 'string' && v.length <= 96 && /^[\p{L}\p{N} ._~:/+|\-]+$/u.test(v) && !/@/.test(v) && !/(?:\+?\d[ ().-]*){8,}/.test(v) ? v : '';
  const path = (v: any) => typeof v === 'string' && /^\/[a-zA-Z0-9/_-]*$/.test(v) && v.length <= 240 ? v : '';
  const timestamp = (v: any) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : '';
  const touch = (v: any) => {
    const raw = obj(v), utm: Record<string, string> = {};
    for (const key of ['source', 'medium', 'campaign', 'id', 'content', 'term']) {
      const value = token(obj(raw.utm)[key]); if (value) utm[key] = value;
    }
    let referrerOrigin = '';
    try { const url = new URL(raw.referrerOrigin); if (/^https?:$/.test(url.protocol) && !url.username && !url.password && !['flat-travel.com','www.flat-travel.com'].includes(url.hostname)) referrerOrigin = url.origin; } catch {}
    const capturedAt = timestamp(raw.capturedAt);
    return {utm, referrerOrigin, landingPath: path(raw.landingPath), ...(capturedAt ? {capturedAt} : {})};
  };
  const raw = obj(input);
  if (raw.schemaVersion !== 'flat-travel-attribution-v1' || raw.status !== 'captured') return {schemaVersion:'flat-travel-attribution-v1', status:'unavailable', reason:raw.reason === 'consent_not_granted' ? raw.reason : 'not_recorded'};
  const events = (Array.isArray(raw.events) ? raw.events : []).slice(-40).flatMap((value: any) => {
    const event = obj(value), pagePath = path(event.path), at = timestamp(event.at);
    if (!pagePath || !at || !['page_view', 'action'].includes(event.type)) return [];
    const action = typeof event.action === 'string' && /^(tailor_next|tailor_back|profile_submit|contact_(email|whatsapp|instagram|messenger)|step_[0-9]{1,2})$/.test(event.action) ? event.action : '';
    if (event.type === 'action' && !action) return [];
    return [{type:event.type, path:pagePath, at, ...(event.type === 'action' ? {action} : {}), ...(event.type === 'page_view' && Number.isInteger(event.elapsedMs) && event.elapsedMs >= 0 && event.elapsedMs <= 1800000 ? {elapsedMs:event.elapsedMs} : {})}];
  });
  return {schemaVersion:'flat-travel-attribution-v1',status:'captured',firstTouch:touch(raw.firstTouch),lastTouch:touch(raw.lastTouch),route:(Array.isArray(raw.route) ? raw.route : []).slice(-30).map(path).filter(Boolean), ...(events.length ? {events} : {})};
}
