export function formatWhatsappPhoneForDisplay(rawValue: string | null | undefined): string {
  const raw = rawValue?.trim() || '';
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;

  if (digits.startsWith('81') && digits.length >= 11 && digits.length <= 13) {
    return formatJapanesePhone(`0${digits.slice(2)}`);
  }

  if (digits.startsWith('0')) {
    return formatJapanesePhone(digits);
  }

  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return raw;
}

export function presentWhatsappDisplayName(
  displayName: string | null | undefined,
  lineUserId: string,
): string {
  const trimmed = displayName?.trim() || '';
  if (!trimmed || isWhatsappPlaceholderName(trimmed) || trimmed === lineUserId) {
    return formatWhatsappPhoneForDisplay(lineUserId);
  }

  return trimmed;
}

function isWhatsappPlaceholderName(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'test whatsapp user' ||
    normalized === 'friend direct test' ||
    normalized === 'whatsapp user' ||
    normalized === 'unknown'
  );
}

function formatJapanesePhone(localDigits: string): string {
  if (/^0\d{9,10}$/.test(localDigits)) {
    if (/^(070|080|090|050)/.test(localDigits) && localDigits.length === 11) {
      return `${localDigits.slice(0, 3)}-${localDigits.slice(3, 7)}-${localDigits.slice(7)}`;
    }

    if (/^0\d{9}$/.test(localDigits)) {
      return `${localDigits.slice(0, 2)}-${localDigits.slice(2, 6)}-${localDigits.slice(6)}`;
    }
  }

  return localDigits;
}
