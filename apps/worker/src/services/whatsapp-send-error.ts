// Never expose provider response bodies: they can contain contacts, URLs or tokens.
export class WhatsappSendError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: 409 | 422 | 429 | 502 = 422,
    readonly providerCode: string | null = null,
    readonly providerSubcode: string | null = null,
  ) { super(message); this.name = 'WhatsappSendError'; }

  response() {
    return { success: false, error: this.message, code: this.code,
      ...(this.providerCode ? { providerCode: this.providerCode } : {}),
      ...(this.providerSubcode ? { providerSubcode: this.providerSubcode } : {}) };
  }
}

function numericCode(value: unknown): string | null {
  return (typeof value === 'number' || typeof value === 'string') && /^\d{1,12}$/.test(String(value))
    ? String(value) : null;
}

export function whatsappProviderError(status: number, body: string): WhatsappSendError {
  let code: string | null = null;
  let subcode: string | null = null;
  try { const error = JSON.parse(body)?.error; code = numericCode(error?.code); subcode = numericCode(error?.error_subcode); } catch { /* non-JSON provider failure */ }
  if (status >= 500) {
    const unknown = whatsappUnknownOutcome();
    return new WhatsappSendError(unknown.message, unknown.code, unknown.httpStatus, code, subcode);
  }
  let message = 'WhatsAppに送信を拒否されました。宛先・添付と接続設定を確認してください。';
  let httpStatus: 409 | 422 | 429 | 502 = 422;
  if (code === '190' || status === 401 || status === 403) message = 'WhatsAppの認証または送信権限に問題があります。管理者が接続設定を確認してください。';
  else if (code === '131047') { message = 'WhatsAppの返信期限を過ぎています。承認済みテンプレートで会話を再開してください。'; httpStatus = 409; }
  else if (code === '131062') message = 'このメッセージ形式はWhatsAppの返信用ID宛てに送れません。形式を確認してください。';
  else if (['100', '131009', '131026', '131030'].includes(code || '')) message = 'WhatsAppの宛先または送信内容が無効です。返信用ID・電話番号と添付を確認してください。';
  else if (['130429', '131056'].includes(code || '') || status === 429) { message = 'WhatsAppの送信制限に達しました。送信履歴を確認してから時間をおいて操作してください。'; httpStatus = 429; }
  else if (['131051', '131052', '131053'].includes(code || '')) message = 'WhatsAppで添付を処理できませんでした。ファイル形式・サイズを確認してください。';
  if (code) message += `（Metaコード: ${code}${subcode ? ` / ${subcode}` : ''}）`;
  return new WhatsappSendError(message, 'WHATSAPP_PROVIDER_REJECTED', httpStatus, code, subcode);
}

export function whatsappUnknownOutcome(): WhatsappSendError {
  return new WhatsappSendError('WhatsAppの送信結果を確認できません。重複送信を避けるため、再送せず送信履歴を確認してください。', 'WHATSAPP_SEND_OUTCOME_UNKNOWN', 502);
}
