export const POST_ORDER_FORM_ID = '72fa9940-164a-4efb-9ad8-e819bfeb8c91';
export const PRE_ORDER_FORM_ID = '9ab583b2-e42e-4ca2-bcb9-13a3c59f5477';

export function isCaseBoundPreOrder(issue: { form_id: string; name: string | null } | null): boolean {
  return issue?.form_id === PRE_ORDER_FORM_ID && issue.name === 'FlatWorker受注前アンケート';
}

function named(value: unknown, labels: string[]): string {
  if (typeof value !== 'string') return '';
  for (const line of value.split('\n')) {
    const pair = line.match(/^\s*([^:：]+)[:：]\s*(.*)$/);
    if (pair && labels.includes(pair[1].trim())) return pair[2].trim();
  }
  return '';
}

export function validatePostOrderAnswers(data: Record<string, unknown>): string | null {
  if (data.consent !== 'Agreed / 同意済み') return 'Please confirm your consent before sending.';
  if (typeof data.q2 !== 'string' || data.q2.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.q2)) return 'Q2: Please enter a valid email address.';
  for (const q of ['q42', 'q43']) {
    const number = named(data[q], ['Flight number', '便名']).normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    if (/^(NOTBOOKED|NOTFLYING|UNKNOWN|未定|利用なし)$/.test(number)) continue;
    const day = named(data[q], ['Arrival date (Japan time)', 'Departure date (Japan time)', '到着日（日本の時間）', '出発日（日本の時間）']);
    if (!/^(?:[A-Z]{2}|[A-Z][0-9]|[0-9][A-Z])[0-9]{1,4}[A-Z]?$/.test(number)) return `${q.toUpperCase()}: Enter the complete flight number, such as AF274, or Not booked / Not flying.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) return `${q.toUpperCase()}: Enter the date in Japan (YYYY-MM-DD).`;
  }
  for (const q of ['q17', 'q18', 'q22']) {
    if (data[q] == null || data[q] === '') continue;
    if (typeof data[q] !== 'string') return `${q.toUpperCase()}: Invalid measurement format.`;
    for (const line of (data[q] as string).split('\n').map(v => v.trim()).filter(Boolean)) {
      if (/^(?:Device|Traveller|機器|旅行者|対象の方)\s*\d+/.test(line)) continue;
      const pair = line.match(/^([^:：]+)[:：]\s*(.*)$/);
      const value = pair ? pair[2] : line;
      const label = pair?.[1] || '';
      const max = q === 'q18' || /Weight|体重/.test(label) ? 500 : /Length|全長/.test(label) ? 300 : /Width|全幅/.test(label) ? 200 : 250;
      if (value && (!/^\d+(?:\.\d+)?$/.test(value) || !(Number(value) > (q === 'q22' && /Height|身長/.test(label) ? 30 : 0) && Number(value) <= max))) return `${q.toUpperCase()}: Use positive numbers in cm / kg. Leave unknown equipment measurements blank.`;
    }
  }
  return null;
}
