export const TRAVEL_QUOTE_INTENT_PATH = '/api/travel/quote-intents';
export const TRAVEL_QUOTE_INTENT_MAX_BYTES = 12_000;

export const TRAVEL_QUOTE_ALLOWED_ORIGINS = new Set([
  'https://flat-travel-design-preview.flat-travel.workers.dev',
  'https://flat-travel.com',
  'https://www.flat-travel.com',
]);

const REFERENCE_PATTERN = /^(?:FTQ|FT)-\d{8}-[A-Z0-9]{8}$/;
const MODES = new Set(['journey', 'private', 'agent']);
const CHANNELS = new Set(['whatsapp', 'instagram', 'messenger']);

export type TravelQuoteIntent = {
  quoteReference: string;
  mode: 'journey' | 'private' | 'agent';
  channel: 'whatsapp' | 'instagram' | 'messenger';
  source: string;
  tourId: string | null;
  title: string | null;
  startDate: string | null;
  days: number | null;
  travellers: number | null;
  route: string[];
  packageTotalJpy: number | null;
  priceStatus: string | null;
  customerName: string;
  wheelchairBrand: string;
  wheelchairModel: string;
  createdAt: string;
};

type ParseResult = { ok: true; value: TravelQuoteIntent } | { ok: false; error: string };

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

export function parseTravelQuoteIntent(input: unknown): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'JSON object required' };
  const body = input as Record<string, unknown>;
  const quoteReference = text(body.quoteReference, 32);
  const mode = text(body.mode, 16);
  const channel = text(body.channel, 16);
  if (!quoteReference || !REFERENCE_PATTERN.test(quoteReference)) return { ok: false, error: 'Invalid quotation reference' };
  if (!mode || !MODES.has(mode)) return { ok: false, error: 'Invalid trip mode' };
  if (!channel || !CHANNELS.has(channel)) return { ok: false, error: 'Invalid communication channel' };

  const route = Array.isArray(body.route) ? body.route.map((item) => text(item, 80)).filter((item): item is string => Boolean(item)).slice(0, 12) : [];
  const startDate = text(body.startDate, 10);
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: 'Invalid start date' };
  const createdAt = text(body.createdAt, 40);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return { ok: false, error: 'Invalid creation time' };
  const customerName = text(body.customerName, 100);
  const wheelchairBrand = text(body.wheelchairBrand, 100);
  const wheelchairModel = text(body.wheelchairModel, 100);
  if (!customerName) return { ok: false, error: 'Traveller name required' };
  if (!wheelchairBrand) return { ok: false, error: 'Wheelchair brand required' };
  if (!wheelchairModel) return { ok: false, error: 'Wheelchair model required' };

  return {
    ok: true,
    value: {
      quoteReference,
      mode: mode as TravelQuoteIntent['mode'],
      channel: channel as TravelQuoteIntent['channel'],
      source: text(body.source, 120) || 'flat-travel-website',
      tourId: text(body.tourId, 120),
      title: text(body.title, 180),
      startDate,
      days: body.days == null ? null : integer(body.days, 1, 60),
      travellers: body.travellers == null ? null : integer(body.travellers, 1, 30),
      route,
      packageTotalJpy: body.packageTotalJpy == null ? null : integer(body.packageTotalJpy, 0, 100_000_000),
      priceStatus: text(body.priceStatus, 240),
      customerName,
      wheelchairBrand,
      wheelchairModel,
      createdAt: new Date(createdAt).toISOString(),
    },
  };
}

export function travelQuoteNotificationCopy(intent: TravelQuoteIntent): { title: string; body: string } {
  const journey = intent.title || intent.tourId || (intent.mode === 'private' ? 'Private Travel' : 'Selected Journey');
  const total = intent.packageTotalJpy == null ? 'specialist confirmation required' : `¥${new Intl.NumberFormat('ja-JP').format(intent.packageTotalJpy)}`;
  const details = [
    `Ref: ${intent.quoteReference}`,
    `Journey: ${journey}`,
    intent.startDate ? `Start: ${intent.startDate}${intent.days ? ` · ${intent.days} days` : ''}` : null,
    intent.travellers ? `Party: ${intent.travellers}` : null,
    intent.route.length ? `Route: ${intent.route.join(' → ')}` : null,
    `Estimate: ${total}`,
    `Traveller: ${intent.customerName}`,
    `Wheelchair: ${intent.wheelchairBrand} ${intent.wheelchairModel}`,
    `Selected channel: ${intent.channel}`,
  ].filter((value): value is string => Boolean(value));
  return { title: `Flat Travel estimate · ${intent.quoteReference}`, body: details.join('\n') };
}
