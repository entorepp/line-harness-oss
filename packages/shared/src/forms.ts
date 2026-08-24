import type { CityDateEntry, FormField, FormFieldVisibilityCondition } from './types';

export type CityDateEntriesIssue = 'empty' | 'incomplete' | 'invalid_range' | null;

const OTHER_CITY_SENTINEL = '__other__';

export function normalizeCityDateEntries(value: unknown): CityDateEntry[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];

    const record = item as Record<string, unknown>;
    const rawCity = normalizeStringValue(record.city);
    const city = rawCity === OTHER_CITY_SENTINEL ? '' : rawCity;
    const legacyDates = normalizeStringValue(record.dates);
    const startDate = normalizeStringValue(record.startDate);
    const endDate = normalizeStringValue(record.endDate);
    const dates = startDate || endDate
      ? [startDate, endDate].filter(Boolean).join(' to ')
      : legacyDates;
    if (!city && !dates) return [];
    return [{ city, dates, startDate, endDate }];
  });
}

export function getCityDateEntriesIssue(value: unknown): CityDateEntriesIssue {
  const entries = normalizeCityDateEntries(value);
  if (entries.length === 0) return 'empty';
  if (entries.some((entry) => (
    !entry.city
    || (Boolean(entry.startDate || entry.endDate) && (!entry.startDate || !entry.endDate))
    || (!entry.startDate && !entry.endDate && !entry.dates)
  ))) return 'incomplete';
  if (entries.some((entry) => (
    entry.startDate && entry.endDate && entry.endDate < entry.startDate
  ))) return 'invalid_range';
  return null;
}

function normalizeStringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toComparableNumber(value: unknown): number | null {
  const normalized = normalizeStringValue(value);
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) {
    return actual.some((item) => valuesMatch(item, expected));
  }

  if (typeof expected === 'number') {
    const actualNumber = toComparableNumber(actual);
    return actualNumber !== null && actualNumber === expected;
  }

  if (typeof expected === 'boolean') {
    if (typeof actual === 'boolean') return actual === expected;
    return normalizeStringValue(actual).toLowerCase() === String(expected);
  }

  return normalizeStringValue(actual) === normalizeStringValue(expected);
}

export function hasFormFieldValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value === undefined || value === null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return normalizeStringValue(value).length > 0;
}

export function isFormFieldVisible(
  field: FormField,
  values: Record<string, unknown>,
): boolean {
  const condition = field.visibleWhen;
  if (!condition?.field?.trim()) return true;

  const actual = values[condition.field];
  const operator = condition.operator ?? 'equals';
  const expected = condition.value;
  const hasActualValue = hasFormFieldValue(actual);

  switch (operator) {
    case 'equals':
      return hasActualValue && valuesMatch(actual, expected);
    case 'not_equals':
      return hasActualValue && !valuesMatch(actual, expected);
    case 'includes':
      return hasActualValue && valuesMatch(actual, expected);
    case 'not_includes':
      return hasActualValue && !valuesMatch(actual, expected);
    case 'greater_than': {
      const actualNumber = toComparableNumber(actual);
      const expectedNumber = toComparableNumber(expected);
      return actualNumber !== null && expectedNumber !== null && actualNumber > expectedNumber;
    }
    case 'less_than': {
      const actualNumber = toComparableNumber(actual);
      const expectedNumber = toComparableNumber(expected);
      return actualNumber !== null && expectedNumber !== null && actualNumber < expectedNumber;
    }
    case 'answered':
      return hasFormFieldValue(actual);
    case 'not_answered':
      return !hasFormFieldValue(actual);
    default:
      return true;
  }
}

export function getVisibleFormFields(
  fields: FormField[],
  values: Record<string, unknown>,
): FormField[] {
  const allFieldNames = new Set(fields.map((field) => field.name));
  const visibleFieldNames = new Set<string>();
  const visibleFields: FormField[] = [];

  for (const field of fields) {
    const sourceFieldName = field.visibleWhen?.field?.trim();
    if (
      sourceFieldName
      && allFieldNames.has(sourceFieldName)
      && !visibleFieldNames.has(sourceFieldName)
    ) {
      continue;
    }

    if (isFormFieldVisible(field, values)) {
      visibleFields.push(field);
      visibleFieldNames.add(field.name);
    }
  }

  return visibleFields;
}

export function normalizeFormFieldVisibilityCondition(
  value: unknown,
): FormFieldVisibilityCondition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const field = normalizeStringValue(record.field);
  if (!field) return undefined;

  const operator = normalizeStringValue(record.operator) as FormFieldVisibilityCondition['operator'];
  const next: FormFieldVisibilityCondition = { field };

  if (operator) next.operator = operator;

  if ('value' in record) {
    const rawValue = record.value;
    if (
      typeof rawValue === 'string'
      || typeof rawValue === 'number'
      || typeof rawValue === 'boolean'
    ) {
      next.value = rawValue;
    }
  }

  return next;
}
