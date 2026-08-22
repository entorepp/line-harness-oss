export const TRAVEL_QUOTE_INTENT_PATH = '/api/travel/quote-intents';
export const TRAVEL_QUOTE_INTENT_MAX_BYTES = 48_000;
export const TRAVEL_PROFILE_CONSENT_VERSION = 'flat-travel-profile-v1';
export const TRAVEL_PROFILE_SCHEMA_VERSION = 'flat-travel-traveller-v3';
export const TRAVEL_PROFILE_LEGACY_SCHEMA_VERSION = 'flat-travel-traveller-v2';

export const TRAVEL_QUOTE_ALLOWED_ORIGINS = new Set([
  'https://flat-travel-design-preview.flat-travel.workers.dev',
  'https://flat-travel.com',
  'https://www.flat-travel.com',
]);

const REFERENCE_PATTERN = /^(?:FTQ|FT)-\d{8}-[A-Z0-9]{8}$/;
const MODES = new Set(['journey', 'private', 'agent']);
const CHANNELS = new Set(['whatsapp', 'instagram', 'messenger', 'email']);
const ASSISTANCE_METHODS = new Set(['independent', 'companion', 'arrange_support', 'unsure']);
const WHEELCHAIR_DEVICES = new Set(['Manual wheelchair', 'Power wheelchair', 'Mobility scooter']);
const HEAVY_MOBILITY_DEVICES = new Set(['Power wheelchair', 'Mobility scooter']);
const PROFILE_SCHEMA_VERSIONS = new Set([TRAVEL_PROFILE_SCHEMA_VERSION, TRAVEL_PROFILE_LEGACY_SCHEMA_VERSION]);

export type AgreementHotel = {
  stayId: string;
  sanityId: string;
  didaHotelId: string;
  city: string;
  nights: number | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  name: string;
  roomType: string;
  rooms: Array<{
    requestedRoomType: 'accessible' | 'universal' | 'standard';
    adultsPerRoom: number | null;
    roomCount: number;
    roomName: string;
    bedType: string;
    inventoryCount: number | null;
    estimateJpy: number | null;
    availabilityStatus: string;
    physicalAccessibilityConfirmed: false;
  }>;
  mealPlan: string;
  cancellationPolicy: string;
  cancellationType: string;
  cancellationDeadline: string | null;
  roomSizeM2: number | null;
  bathroomInfo: string;
  toiletInfo: string;
  selectionType: string;
  selectionStatus: string;
  availabilityStatus: string;
  accessibilityStatus: string;
  priceStatus: string;
  rateSource: string;
  didaSaleAvailable: boolean;
  liveCheckedAt: string | null;
  request: string;
  estimateJpy: number | null;
};

export type AgreementMovement = {
  id: string;
  sanityId: string;
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
  unitPriceJpy: number | null;
  fixedUnitPriceJpy: number | null;
  priceBasis: 'perPerson' | 'perVehicle' | 'perGroup' | 'perArrangement' | null;
  passengerCapacity: number | null;
  bidirectional: boolean | null;
  estimateJpy: number | null;
  displayGroupId: string;
  displayGroupOrigin: string;
  displayGroupDestination: string;
  displayGroupSequence: number | null;
  displayGroupMemberCount: number | null;
  timeControlMovement: boolean;
};

export type AgreementSelection = {
  id: string;
  sanityId: string;
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
  profileSchemaVersion: typeof TRAVEL_PROFILE_SCHEMA_VERSION | typeof TRAVEL_PROFILE_LEGACY_SCHEMA_VERSION | null;
  customerName: string;
  givenName: string;
  familyName: string;
  email: string;
  bodyHeightCm: number | null;
  bodyWeightKg: number | null;
  wheelchairBrand: string;
  wheelchairModel: string;
  wheelchairWeightKg: number | null;
  mobilityDeviceType: string | null;
  assistanceMethod: string | null;
  boardingPreference: string | null;
  supportNote: string | null;
  supportNeeds: string[];
  profileConsentVersion: typeof TRAVEL_PROFILE_CONSENT_VERSION | null;
  profileConsentedAt: string | null;
  profileProvided: boolean;
  agreementSnapshot: AgreementSnapshot;
  createdAt: string;
};

export type FlatworkerDraftSummary = {
  status: 'created' | 'updated' | 'existing' | 'failed' | 'not_configured';
  caseId: string;
  caseUrl?: string;
  profileStored?: boolean;
  automationReadiness?: {
    status: 'ready_for_staff_review' | 'needs_data';
    blockingIssueCount: number;
  };
  upstreamStatus?: number;
  errorCode?: string;
  errorMessage?: string;
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
  const allowed = new Set(['destinations', 'themes', 'startDate', 'duration', 'partySize', 'budget', 'namedHotels', 'transportPreferences']);
  const longAnswers = new Set(['namedHotels', 'transportPreferences']);
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
  const estimateSource = objectValue(source.estimate);
  const tailorMadeSource = objectValue(source.tailorMade);
  const capturedAt = text(source.capturedAt, 40);
  const capturedIso = capturedAt && !Number.isNaN(Date.parse(capturedAt)) ? new Date(capturedAt).toISOString() : new Date(String(fallback.createdAt)).toISOString();
  const route = textList(itinerarySource.route, 12, 80);
  const hotels = (Array.isArray(source.hotels) ? source.hotels : []).slice(0, 12).map((raw) => {
    const item = objectValue(raw);
    return {
      stayId: text(item.stayId, 100) || '',
      sanityId: text(item.sanityId ?? item.hotelId ?? item.publicHotelId, 160) || '',
      didaHotelId: text(item.didaHotelId, 100) || '',
      city: text(item.city, 100) || '',
      nights: item.nights == null ? null : integer(item.nights, 1, 60),
      checkInDate: dateValue(item.checkInDate),
      checkOutDate: dateValue(item.checkOutDate),
      name: text(item.name, 180) || 'Hotel to confirm',
      roomType: text(item.roomType, 240) || 'To confirm',
      rooms: (Array.isArray(item.rooms) ? item.rooms : []).slice(0, 8).map((rawRoom) => {
        const room = objectValue(rawRoom);
        const requestedRoomType = text(room.requestedRoomType, 40);
        return {
          requestedRoomType: (requestedRoomType === 'universal' || requestedRoomType === 'standard' ? requestedRoomType : 'accessible') as 'accessible' | 'universal' | 'standard',
          adultsPerRoom: room.adultsPerRoom == null ? null : integer(room.adultsPerRoom, 1, 30),
          roomCount: room.roomCount == null ? 1 : integer(room.roomCount, 1, 30) || 1,
          roomName: text(room.roomName, 240) || 'To confirm',
          bedType: text(room.bedType, 160) || 'To confirm',
          inventoryCount: room.inventoryCount == null ? null : integer(room.inventoryCount, 0, 10_000),
          estimateJpy: room.estimateJpy == null ? null : integer(room.estimateJpy, 0, 100_000_000),
          availabilityStatus: text(room.availabilityStatus, 80) || 'requires_supplier_confirmation',
          physicalAccessibilityConfirmed: false as const,
        };
      }),
      mealPlan: text(item.mealPlan, 160) || 'To confirm',
      cancellationPolicy: text(item.cancellationPolicy ?? item.cancellation, 1000) || '',
      cancellationType: text(item.cancellationType, 80) || '',
      cancellationDeadline: dateValue(item.cancellationDeadline),
      roomSizeM2: item.roomSizeM2 == null ? null : numberValue(item.roomSizeM2, 0, 1000),
      bathroomInfo: text(item.bathroomInfo, 500) || 'To confirm',
      toiletInfo: text(item.toiletInfo, 500) || 'To confirm',
      selectionType: text(item.selectionType, 40) || 'listed',
      selectionStatus: text(item.selectionStatus, 60) || 'customer_selected',
      availabilityStatus: text(item.availabilityStatus, 80) || 'requires_supplier_confirmation',
      accessibilityStatus: text(item.accessibilityStatus, 80) || 'requires_human_confirmation',
      priceStatus: text(item.priceStatus, 60) || 'not_quoted',
      rateSource: text(item.rateSource, 60) || '',
      didaSaleAvailable: item.didaSaleAvailable === true,
      liveCheckedAt: (() => {
        const value = text(item.liveCheckedAt, 40);
        return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
      })(),
      request: text(item.request, 500) || '',
      estimateJpy: item.estimateJpy == null ? null : integer(item.estimateJpy, 0, 100_000_000),
    };
  });
  const railAndTransfers = (Array.isArray(source.railAndTransfers) ? source.railAndTransfers : []).slice(0, 20).map((raw) => {
    const item = objectValue(raw);
    const submittedUnitPrice = item.unitPriceJpy ?? item.fixedUnitPriceJpy;
    const unitPriceJpy = submittedUnitPrice == null ? null : integer(submittedUnitPrice, 1, 100_000_000);
    const priceBasis = ['perPerson', 'perVehicle', 'perGroup', 'perArrangement'].includes(String(item.priceBasis))
      ? item.priceBasis as Exclude<AgreementMovement['priceBasis'], null>
      : null;
    return {
      id: text(item.id, 100) || '',
      sanityId: text(item.sanityId ?? item.transportId, 160) || '',
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
      unitPriceJpy,
      // Keep the old name populated during the compatibility window so an older
      // TravelWorker revision still receives the same canonical tariff amount.
      fixedUnitPriceJpy: unitPriceJpy,
      priceBasis,
      passengerCapacity: item.passengerCapacity == null ? null : integer(item.passengerCapacity, 1, 30),
      bidirectional: typeof item.bidirectional === 'boolean' ? item.bidirectional : null,
      estimateJpy: item.estimateJpy == null ? null : integer(item.estimateJpy, 0, 100_000_000),
      displayGroupId: text(item.displayGroupId, 100) || '',
      displayGroupOrigin: text(item.displayGroupOrigin, 120) || '',
      displayGroupDestination: text(item.displayGroupDestination, 120) || '',
      displayGroupSequence: item.displayGroupSequence == null ? null : integer(item.displayGroupSequence, 1, 20),
      displayGroupMemberCount: item.displayGroupMemberCount == null ? null : integer(item.displayGroupMemberCount, 2, 20),
      timeControlMovement: item.timeControlMovement === true,
    };
  });
  const selections = (Array.isArray(source.selections) ? source.selections : []).slice(0, 30).map((raw) => {
    const item = objectValue(raw);
    return {
      id: text(item.id, 100) || '',
      sanityId: text(item.sanityId ?? item.tourId, 160) || '',
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
      name: '',
      mobilityDeviceType: '',
      wheelchairBrand: '',
      wheelchairModel: '',
      supportNote: '',
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
  const givenName = text(body.givenName, 100) || '';
  const familyName = text(body.familyName, 100) || '';
  const legacyCustomerName = text(body.customerName, 100) || '';
  if (Boolean(givenName) !== Boolean(familyName)) return { ok: false, error: 'Both traveller name fields are required' };
  const customerName = [givenName, familyName].filter(Boolean).join(' ') || legacyCustomerName;
  const email = text(body.email, 320) || '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Invalid traveller email' };
  const wheelchairBrand = text(body.wheelchairBrand, 100) || '';
  const wheelchairModel = text(body.wheelchairModel, 100) || '';
  const mobilityDeviceType = text(body.mobilityDeviceType, 100);
  const profileSchemaVersion = text(body.profileSchemaVersion, 80);
  if (profileSchemaVersion && !PROFILE_SCHEMA_VERSIONS.has(profileSchemaVersion)) return { ok: false, error: 'Invalid traveller profile schema' };
  const bodyHeightCm = body.bodyHeightCm == null ? null : numberValue(body.bodyHeightCm, 30, 250);
  const bodyWeightKg = body.bodyWeightKg == null ? null : numberValue(body.bodyWeightKg, 1, 500);
  const wheelchairWeightKg = body.wheelchairWeightKg == null ? null : numberValue(body.wheelchairWeightKg, 1, 500);
  if ((body.bodyHeightCm != null && bodyHeightCm == null) || (body.bodyWeightKg != null && bodyWeightKg == null) || (body.wheelchairWeightKg != null && wheelchairWeightKg == null)) return { ok: false, error: 'Invalid traveller measurement' };
  const assistanceMethod = text(body.assistanceMethod, 40);
  const boardingPreference = text(body.boardingPreference, 160);
  const supportNote = text(body.supportNote, 1000);
  const supportNeeds = textList(body.supportNeeds, 12, 160);
  const profileProvided = Boolean(customerName || givenName || familyName || email || wheelchairBrand || wheelchairModel || mobilityDeviceType || bodyHeightCm || bodyWeightKg || wheelchairWeightKg || assistanceMethod || boardingPreference || supportNote || supportNeeds.length);
  const profileConsentVersion = text(body.profileConsentVersion, 80);
  const consentedAt = text(body.profileConsentedAt, 40);
  const profileConsentedAt = consentedAt && !Number.isNaN(Date.parse(consentedAt)) ? new Date(consentedAt).toISOString() : null;
  if (profileProvided && (profileConsentVersion !== TRAVEL_PROFILE_CONSENT_VERSION || !profileConsentedAt)) {
    return { ok: false, error: 'Traveller profile consent required' };
  }
  if (PROFILE_SCHEMA_VERSIONS.has(profileSchemaVersion || '')) {
    if (!customerName || !mobilityDeviceType || !assistanceMethod || !ASSISTANCE_METHODS.has(assistanceMethod)) return { ok: false, error: 'Required traveller details missing' };
    if (profileSchemaVersion === TRAVEL_PROFILE_SCHEMA_VERSION && !email) return { ok: false, error: 'Traveller email required' };
    if (WHEELCHAIR_DEVICES.has(mobilityDeviceType) && (!wheelchairBrand || !wheelchairModel || !boardingPreference)) return { ok: false, error: 'Wheelchair details missing' };
    if (HEAVY_MOBILITY_DEVICES.has(mobilityDeviceType) && bodyWeightKg == null) return { ok: false, error: 'Power mobility body weight missing' };
  }

  const normalizedCreatedAt = new Date(createdAt).toISOString();
  const fallback = { ...body, createdAt: normalizedCreatedAt };
  const agreementSnapshot = parseAgreementSnapshot(body.agreementSnapshot, fallback);
  if (mode === 'journey') {
    if (!agreementSnapshot.railAndTransfers.length) {
      return { ok: false, error: 'Journey movement tariff contract required' };
    }
    for (const movement of agreementSnapshot.railAndTransfers) {
      if (!movement.id || !movement.sanityId) {
        return { ok: false, error: 'Journey movement identity required' };
      }
      if (movement.unitPriceJpy == null) {
        return { ok: false, error: 'Journey movement tariff required' };
      }
      if (!movement.priceBasis) {
        return { ok: false, error: 'Journey movement pricing basis required' };
      }
      if (movement.priceBasis === 'perVehicle' && movement.passengerCapacity == null) {
        return { ok: false, error: 'Journey movement capacity required' };
      }
      if (movement.bidirectional == null) {
        return { ok: false, error: 'Journey movement direction contract required' };
      }
    }
  }
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
      profileSchemaVersion: PROFILE_SCHEMA_VERSIONS.has(profileSchemaVersion || '') ? profileSchemaVersion as TravelQuoteIntent['profileSchemaVersion'] : null,
      customerName,
      givenName,
      familyName,
      email,
      bodyHeightCm,
      bodyWeightKg,
      wheelchairBrand,
      wheelchairModel,
      wheelchairWeightKg,
      mobilityDeviceType,
      assistanceMethod,
      boardingPreference,
      supportNote,
      supportNeeds,
      profileConsentVersion: profileProvided ? TRAVEL_PROFILE_CONSENT_VERSION : null,
      profileConsentedAt: profileProvided ? profileConsentedAt : null,
      profileProvided,
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
    const room = [hotel.roomType, hotel.mealPlan, hotel.cancellationType === 'free_cancellation_until' ? '無料キャンセル可能' : '取消条件要確認', hotel.roomSizeM2 ? `${hotel.roomSizeM2}m²` : '', hotel.estimateJpy != null ? money(hotel.estimateJpy) : ''].filter(Boolean).join(' / ');
    return `・${stay} | ${hotel.name}${room ? ` | ${room}` : ''}\n  顧客選択済み · 在庫=${hotel.availabilityStatus} · 身体適合=${hotel.accessibilityStatus} · 価格=${hotel.priceStatus}`;
  }), 8);
  const movements = compactLines(agreement.railAndTransfers.map((movement) =>
    `・${movement.serviceDate || `Day ${movement.dayStart || '?'}`} | ${movement.origin || '出発地'} → ${movement.destination || '到着地'} | ${movement.mode} | ${movement.preferredTimeLabel}`,
  ), 10);
  const selections = compactLines(agreement.selections.map((item) => `・${[item.dayLabel, item.kind, item.title].filter(Boolean).join(' · ')}`), 8);
  const confirmations = compactLines(agreement.openConfirmations.map((item) => `・${item}`), 10);
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
    draft?.profileStored ? '顧客プロフィール: FlatWorkerへ暗号化保存済み' : '顧客プロフィール: FlatWorkerで要確認',
    draft?.automationReadiness?.status === 'ready_for_staff_review'
      ? '自動見積: ルール照合済み・担当者レビュー可能'
      : `自動見積: データ不足 ${Number(draft?.automationReadiness?.blockingIssueCount || 0)}件`,
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

export function travelQuoteReceiptMetadata(intent: TravelQuoteIntent, draft: FlatworkerDraftSummary): Record<string, unknown> {
  return {
    quoteReference: intent.quoteReference,
    mode: intent.mode,
    channel: intent.channel,
    source: intent.source,
    tourId: intent.tourId,
    title: intent.title,
    startDate: intent.startDate,
    days: intent.days,
    travellers: intent.travellers,
    route: intent.route,
    packageTotalJpy: intent.packageTotalJpy,
    priceStatus: intent.priceStatus,
    agreementSnapshot: intent.agreementSnapshot,
    profileProvided: intent.profileProvided,
    profileStored: draft.profileStored === true,
    flatworkerDraft: draft,
    createdAt: intent.createdAt,
  };
}
