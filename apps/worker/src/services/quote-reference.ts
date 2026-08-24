const QUOTE_REFERENCE_PATTERN = /(?:^|\s)((?:FTQ|FT)-\d{8}-[A-Z0-9]{8})(?=$|\s|[.,!?。、！？」』)\]])/gi;

export function extractSingleQuoteReference(text: string): string | null {
  const matches = [...text.matchAll(QUOTE_REFERENCE_PATTERN)].map((match) => match[1].toUpperCase());
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
}
