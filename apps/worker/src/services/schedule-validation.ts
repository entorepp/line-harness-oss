import { toJstString } from '@line-crm/db';

const EXPLICIT_TIME_ZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

export type ScheduledAtValidation =
  | { ok: true; scheduledAt: string }
  | { ok: false; error: string };

export function normalizeFutureScheduledAt(value: string | null | undefined): ScheduledAtValidation {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) {
    return { ok: false, error: '予約日時を指定してください' };
  }

  if (!EXPLICIT_TIME_ZONE_PATTERN.test(input)) {
    return { ok: false, error: '予約日時にはタイムゾーンを含めてください' };
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return { ok: false, error: '予約日時の形式が正しくありません' };
  }

  if (date.getTime() <= Date.now()) {
    return { ok: false, error: '予約日時は現在時刻より後の日時を指定してください' };
  }

  return { ok: true, scheduledAt: toJstString(date) };
}
