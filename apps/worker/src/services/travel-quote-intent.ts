export const TRAVEL_QUOTE_INTENT_PATH = '/api/travel/quote-intents';
export const TRAVEL_QUOTE_INTENT_MAX_BYTES = 48_000;

export const TRAVEL_QUOTE_ALLOWED_ORIGINS = new Set([
  'https://flat-travel-design-preview.flat-travel.workers.dev',
  'https://flat-travel.com',
  'https://www.flat-travel.com',
]);

const REFERENCE_PATTERN = /^(?:FTQ|FT)-\d{8}-[A-Z0-9]{8}$/;
const MODES = new Set(['journey', 'private', 'agent']);
const CHANNELS = new Set(['whatsapp', 'instagram', 'messenger', 'email']);

export type AgreementHotel = {
  stayId: string;
  city: string;
  nights: number | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  name: string;
  roomType: string;
  mealPlan: string;
  roomSizeM2: number | null;
  bathroomInfo: string;
  toiletInfo: string;
  selectionType: string;
  selectionStatus: string;
  availabilityStatus: string;
  accessibilityStatus: string;
  priceStatus: string;
  request: string;
  estimateJpy: number | null;
};

export type AgreementMovement = {
  id: string;
  dayStart: number | null;
  dayEnd: number | null;
  serviceDate: string | null;
  origin: string;
  destination: string;
  mode: string;
  preferredTimeSlot: string;
  preferredTimeLabel: string;
  selectionStatus: string;
  supplierStatus: string;
};

export type AgreementSelection = {
  id: string;
  title: string;
  dayLabel: string;
  kind: string;
  selectionStatus: string;
  estimateJpy: number | null;
};

export type AgreementSnapshot = {
  schemaVersion: 'flat-travel-agreement-v1';
  capturedAt: string;
  agreementBasis: string;
  agreementStatus: string;
  itinerary: {
    title: string;
    tourId: string;
    startDate: string | null;
    days: number | null;
    travellers: number | null;
    route: string[];
  };
  customer: {
    name: string;
    mobilityDeviceType: string;
    wheelchairBrand: string;
    wheelchairModel: string;
    supportNote: string;
  };
  hotels: AgreementHotel[];
  railAndTransfers: AgreementMovement[];
  selections: AgreementSelection[];
  includedItems: string[];
  excludedItems: string[];
  estimate: { currency: 'JPY'; total: number | null; kind: string; priceConfirmed: false };
  tailorMade: { choices: Record<string, string | string[]>; budgetUsd: number | null } | null;
  openConfirmations: string[];
};

export type TravelQuoteIntent = {
  quoteReference: string;
  mode: 'journey' | 'private' | 'agent';
  channel: 'whatsapp' | 'instagram' | 'messenger' | 'email';
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
  mobilityDeviceType: string | null;
  supportNote: string | null;
  agreementSnapshot: AgreementSnapshot;
  createdAt: string;
};

export type FlatworkerDraftSummary = {
  status: 'created' | 'updated' | 'existing' | 'failed' | 'not_configured';
  caseId: string;
  caseUrl?: string;
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

function numberValue(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textList(value: unknown, limit: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, maxLength)).filter((item): item is string => Boolean(item)).slice(0, limit)
    : [];
}

function dateValue(value: unknown): string | null {
  const result = text(value, 10);
  return result && /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function parseChoiceMap(value: unknown): Record<string, string | string[]> {
  const source = objectValue(value);
  const allowed = new Set(['destinations', 'themes', 'startDate', 'duration', 'partySize', 'budget', 'namedHotels', 'transportPreferences', 'mobility', 'support', 'specialRequest']);
  const longAnswers = new Set(['namedHotels', 'transportPreferences', 'specialRequest']);
  const result: Record<string, string | string[]> = {};
  for (const [key, item] of Object.entries(source)) {
    if (!allowed.has(key)) continue;
    if (Array.isArray(item)) {
      result[key] = textList(item, 12, 160);
      continue;
    }
    const normalized = text(item, longAnswers.has(key) ? 1000 : 240);
    if (normalized) result[key] = normalized;
  }
  return result;
}

function parseAgreementSnapshot(value: unknown, fallback: Record<string, unknown>): AgreementSnapshot {
  const source = objectValue(value);
  const itinerarySource = objectValue(source.itinerary);
  const customerSource = objectValue(source.customer);
  const estimateSource = objectValue(source.estimate);
  const tailorMadeSource = objectValue(source.tailorMade);
  const capturedAt = text(source.capturedAt, 40);
  const capturedIso = capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : new Date(String(fallback.createdAt)).toISOString();
  const route = textList(itinerarySource.route, 12, 80);
  const hotels = (Array.isArray(source.hotels) ? source.hotels : []).slice(0, 12).map((raw) => {
    const item = objectValue(raw);
    return {
      stayId: text(item.stayId, 100) || '',
      city: text(item.city, 100) || '',
      nights: item.nights == null ? null : integer(item.nights, 1, 60),
      checkInDate: dateValue(item.checkInDate),
      checkOutDate: dateValue(item.checkOutDate),
      name: text(item.name, 180) || 'Hotel to confirm',
      roomType: text(item.roomType, 240) || 'To confirm',
      mealPlan: text(item.mealPlan, 160) || 'To confirm',
      roomSizeM2: item.roomSizeM2 == null ? null : numberValue(item.roomSizeM2, 0, 1000),
      bathroomInfo: text(item.bathroomInfo, 500) || 'To confirm',
      toiletInfo: text(item.toiletInfo, 500) || 'To confirm',
      selectionType: text(item.selectionType, 40) || 'listed',
      selectionStatus: text(item.selectionStatus, 60) || 'customer_selected',
      availabilityStatus: text(item.availabilityStatus, 80) || 'requires_supplier_confirmation',
      accessibilityStatus: text(item.accessibilityStatus, 80) || 'requires_human_confirmation',
      priceStatus: text(item.priceStatus, 60) || 'estimate',
      request: text(item.request, 500) || '',
      estimateJpy: item.estimateJpy == null ? null : integer(item.estimateJpy, 0, 100_000_000),
    };
  });
  const railAndTransfers = (Array.isArray(source.railAndTransfers) ? source.railAndTransfers : []).slice(0, 20).map((raw) => {
    const item = objectValue(raw);
    return {
      id: text(item.id, 100) || '',
      dayStart: item.dayStart == null ? null : integer(item.dayStart, 1, 60),
      dayEnd: item.dayEnd == null ? null : integer(item.dayEnd, 1, 60),
      serviceDate: dateValue(item.serviceDate),
      origin: text(item.origin, 120) || '',
      destination: text(item.destination, 120) || '',
      mode: text(item.mode, 100) || 'Transport',
      preferredTimeSlot: text(item.preferredTimeSlot, 60) || 'undecided',
      preferredTimeLabel: text(item.preferredTimeLabel, 120) || 'Time not decided',
      selectionStatus: text(item.selectionStatus, 60) || 'customer_selected',
      supplierStatus: text(item.supplierStatus, 80) || 'requires_confirmation',
    };
  });
  const selections = (Array.isArray(source.selections) ? source.selections : []).slice(0, 30).map((raw) => {
    const item = objectValue(raw);
    return {
      id: text(item.id, 100) || '',
      title: text(item.title, 180) || 'Selection',
      dayLabel: text(item.dayLabel, 80) || '',
      kind: text(item.kind, 80) || 'Experience',
      selectionStatus: text(item.selectionStatus, 60) || 'customer_selected',
      estimateJpy: item.estimateJpy == null ? null : integer(item.estimateJpy, 0, 100_000_000),
    };
  });
  const choices = parseChoiceMap(tailorMadeSource.choices);
  const budgetUsd = tailorMadeSource.budgetUsd == null ? null : integer(tailorMadeSource.budgetUsd, 0, 10_000_000);
  return {
    schemaVersion: 'flat-travel-agreement-v1',
    capturedAt: capturedIso,
    agreementBasis: text(source.agreementBasis, 80) || 'customer_submitted_brief',
    agreementStatus: text(source.agreementStatus, 80) || 'brief_submitted',
    itinerary: {
      title: text(itinerarySource.title, 180) || text(fallback.title, 180) || '',
      tourId: text(itinerarySource.tourId, 120) || text(fallback.tourId, 120) || '',
      startDate: dateValue(itinerarySource.startDate) || dateValue(fallback.startDate),
      days: itinerarySource.days == null ? integer(fallback.days, 1, 60) : integer(itinerarySource.days, 1, 60),
      travellers: itinerarySource.travellers == null ? integer(fallback.travellers, 1, 30) : integer(itinerarySource.travellers, 1, 30),
      route: route.length ? route : textList(fallback.route, 12, 80),
    },
    customer: {
      name: text(customerSource.name, 100) || text(fallback.customerName, 100) || '',
      mobilityDeviceType: text(customerSource.mobilityDeviceType, 100) || text(fallback.mobilityDeviceType, 100) || '',
      wheelchairBrand: text(customerSource.wheelchairBrand, 100) || text(fallback.wheelchairBrand, 100) || '',
      wheelchairModel: text(customerSource.wheelchairModel, 100) || text(fallback.wheelchairModel, 100) || '',
      supportNote: text(customerSource.supportNote, 1000) || text(fallback.supportNote, 1000) || '',
    },
    hotels,
    railAndTransfers,
    selections,
    includedItems: textList(source.includedItems, 30, 220),
    excludedItems: textList(source.excludedItems, 30, 220),
    estimate: {
      currency: 'JPY',
      total: estimateSource.total == null ? integer(fallback.packageTotalJpy, 0, 100_000_000) : integer(estimateSource.total, 0, 100_000_000),
      kind: text(estimateSource.kind, 60) || 'not_quoted',
      priceConfirmed: false,
    },
    tailorMade: Object.keys(choices).length || budgetUsd != null ? { choices, budgetUsd } : null,
    openConfirmations: textList(source.openConfirmations, 30, 240),
  };
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

  const route = textList(body.route, 12, 80);
  const startDate = text(body.startDate, 10);
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return { ok: false, error: 'Invalid start date' };
  const createdAt = text(body.createdAt, 40);
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return { ok: false, error: 'Invalid creation time' };
  const customerName = text(body.customerName, 100) || `Website enquiry ${quoteReference}`;
  const wheelchairBrand = text(body.wheelchairBrand, 100) || 'Not collected in operational handoff';
  const wheelchairModel = text(body.wheelchairModel, 100) || 'Not collected in operational handoff';

  const normalizedCreatedAt = new Date(createdAt).toISOString();
  const fallback = { ...body, createdAt: normalizedCreatedAt };
  const agreementSnapshot = parseAgreementSnapshot(body.agreementSnapshot, fallback);
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
      mobilityDeviceType: text(body.mobilityDeviceType, 100),
      supportNote: text(body.supportNote, 1000),
      agreementSnapshot,
      createdAt: normalizedCreatedAt,
    },
  };
}

function money(value: number | null): string {
  return value == null ? '未見積' : `¥${new Intl.NumberFormat('ja-JP').format(value)}`;
}

function compactLines(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  return [...values.slice(0, limit), `…他${values.length - limit}件`];
}

export function travelQuoteNotificationCopy(intent: TravelQuoteIntent, draft?: FlatworkerDraftSummary): { title: string; body: string } {
  const agreement = intent.agreementSnapshot;
  const journey = intent.title || intent.tourId || (intent.mode === 'private' ? 'Tailor-Made Travel' : 'Selected Journey');
  const hotels = compactLines(agreement.hotels.map((hotel) => {
    const stay = [hotel.city, hotel.nights ? `${hotel.nights}泊` : '', hotel.checkInDate && hotel.checkOutDate ? `${hotel.checkInDate}〜${hotel.checkOutDate}` : ''].filter(Boolean).join(' · ');
    const room = [hotel.roomType, hotel.mealPlan, hotel.roomSizeM2 ? `${hotel.roomSizeM2}m²` : '', hotel.estimateJpy != null ? money(hotel.estimateJpy) : ''].filter(Boolean).join(' / ');
    return `・${stay} | ${hotel.name}${room ? ` | ${room}` : ''}\n  顧客選択済み · 在庫=${hotel.availabilityStatus} · 身体適合=${hotel.accessibilityStatus} · 価格=${hotel.priceStatus}`;
  }), 8);
  const movements = compactLines(agreement.railAndTransfers.map((movement) =>
    `・${movement.serviceDate || `Day ${movement.dayStart || '?'}`} | ${movement.origin || '出発地'} → ${movement.destination || '到着地'} | ${movement.mode} | ${movement.preferredTimeLabel}`,
  ), 10);
  const selections = compactLines(agreement.selections.map((item) => `・${[item.dayLabel, item.kind, item.title].filter(Boolean).join(' · ')}`), 8);
  const confirmations = compactLines(agreement.openConfirmations.map((item) => `・${item}`), 10);
  const publicIdentityCollected = !intent.customerName.startsWith('Website enquiry ');
  const publicDeviceCollected = !intent.wheelchairBrand.startsWith('Not collected') && !intent.wheelchairModel.startsWith('Not collected');
  const flatworkerLine = draft
    ? `FlatWorker: ${draft.status} · ${draft.caseId}${draft.caseUrl ? `\n${draft.caseUrl}` : ''}`
    : 'FlatWorker: 未連携';
  const sections = [
    '【受付・顧客回答】',
    `参照番号: ${intent.quoteReference}`,
    `商品: ${journey}`,
    intent.startDate ? `旅行: ${intent.startDate}${intent.days ? ` · ${intent.days}日間` : ''}` : '旅行: 日付要確認',
    intent.travellers ? `人数: ${intent.travellers}名` : '人数: 要確認',
    intent.route.length ? `行き先: ${intent.route.join(' → ')}` : null,
    publicIdentityCollected ? `顧客名: ${intent.customerName}` : '顧客識別: 受付番号で個別メッセージと突合',
    publicDeviceCollected ? `車いす: ${intent.wheelchairBrand} ${intent.wheelchairModel}` : null,
    intent.mobilityDeviceType ? `移動機器: ${intent.mobilityDeviceType}` : null,
    `連絡CTA: ${intent.channel}`,
    hotels.length ? `【顧客が選択したホテル】\n${hotels.join('\n')}` : null,
    movements.length ? `【合意した移動・時間帯】\n${movements.join('\n')}` : null,
    selections.length ? `【体験・ガイド】\n${selections.join('\n')}` : null,
    agreement.includedItems.length ? `【含むもの】\n${compactLines(agreement.includedItems.map((item) => `・${item}`), 8).join('\n')}` : null,
    agreement.excludedItems.length ? `【含まないもの】\n${compactLines(agreement.excludedItems.map((item) => `・${item}`), 8).join('\n')}` : null,
    agreement.tailorMade ? `【テイラーメイド回答】\n${Object.entries(agreement.tailorMade.choices).map(([key, value]) => `・${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}` : null,
    `【概算】\n合計: ${money(agreement.estimate.total)} · ${agreement.estimate.kind}\n※顧客送付前の社内ドラフト。最終価格・在庫・身体適合は未確定。`,
    confirmations.length ? `【手配前の要確認】\n${confirmations.join('\n')}` : null,
    `【FlatWorker】\n${flatworkerLine}`,
  ].filter((value): value is string => Boolean(value));
  return { title: `Flat Travel 旅行回答 · ${intent.quoteReference}`, body: sections.join('\n\n').slice(0, 11_500) };
}
