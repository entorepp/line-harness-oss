import type { LineAccount } from '@line-crm/db';
import { fetchWhatsAppTemplateDefinitions, normalizeWhatsAppTemplate, type RawWhatsAppTemplate } from './whatsapp-initiation.js';

export const OPERATIONAL_TEMPLATES = [
  { name: 'flat_travel_booking_confirmation_v1', label: '予約確定書', document: true,
    body: 'Hello {{1}}, your booking {{2}} with Flat Travel is confirmed. Please review the attached confirmation for your reservation details. If anything is incorrect, please reply to this message.',
    fields: ['お客様名', '予約番号'], examples: ['Alex Example', 'SAMPLE-BOOKING-001'] },
  { name: 'flat_travel_booking_details_v1', label: '予約内容のご案内', document: true,
    body: 'Hello {{1}}, the reservation details for your booking {{2}} with Flat Travel are attached. Please review the document and reply if you have any questions or need to correct any details.',
    fields: ['お客様名', '予約番号'], examples: ['Alex Example', 'SAMPLE-BOOKING-001'] },
  { name: 'flat_travel_rail_document_v1', label: '新幹線・鉄道の予約書類', document: true,
    body: 'Hello {{1}}, the rail reservation document for your Flat Travel booking {{2}}, for travel on {{3}}, is attached. Please check the passenger names, route and departure time in the document. Reply if any details need correction.',
    fields: ['お客様名', '予約番号', '乗車日'], examples: ['Alex Example', 'SAMPLE-RAIL-001', '20 October 2026'] },
  { name: 'flat_travel_requested_quote_v1', label: '依頼された見積り', document: true,
    body: 'Hello {{1}}, the quotation you requested from Flat Travel for enquiry {{2}} is attached. Please review the itinerary, price and conditions in the document. Reply to this message with any questions about your quotation.',
    fields: ['お客様名', '問合せ・見積り番号'], examples: ['Alex Example', 'SAMPLE-QUOTE-001'] },
  { name: 'flat_travel_payment_document_v1', label: '支払い案内・請求書PDF', document: true,
    body: 'Hello {{1}}, the invoice for your Flat Travel booking {{2}} is attached. Please check the amount and due date on the invoice. Your payment link is {{3}}. If you have already paid, please disregard this payment request.',
    fields: ['お客様名', '予約・請求書番号', '支払いURL'], examples: ['Alex Example', 'SAMPLE-INVOICE-001', 'https://flat-travel.com/payment/sample'], urlKeys: ['body:3'] },
  { name: 'flat_travel_payment_link_v1', label: '支払い案内・リンクのみ', document: false,
    body: 'Hello {{1}}, here is the payment link for your Flat Travel booking {{2}}: {{3}}. Please review the amount and payment details on the page before paying. If you have already paid, please disregard this payment request.',
    fields: ['お客様名', '予約・請求書番号', '支払いURL'], examples: ['Alex Example', 'SAMPLE-INVOICE-001', 'https://flat-travel.com/payment/sample'], urlKeys: ['body:3'] },
] as const;

export function operationalTemplate(raw: RawWhatsAppTemplate) {
  const base = normalizeWhatsAppTemplate(raw);
  if (!base) return null;
  const header = raw.components?.find((item) => item.type?.toUpperCase() === 'HEADER');
  const buttons = raw.components?.find((item) => item.type?.toUpperCase() === 'BUTTONS')?.buttons || [];
  const definition = OPERATIONAL_TEMPLATES.find((item) => item.name === base.name);
  const documentRequired = header?.format?.toUpperCase() === 'DOCUMENT';
  const urlButtons = buttons.flatMap((button, index) => button.type?.toUpperCase() === 'URL'
    ? [{ index, label: button.text || 'リンク', url: button.url || '', dynamic: /{{/.test(button.url || '') }] : []);
  let unavailableReason: string | null = null;
  if (base.status !== 'APPROVED') unavailableReason = `Meta承認待ち・使用不可（${base.status}）`;
  else if (base.category !== 'UTILITY') unavailableReason = `実務連絡にはUTILITY承認が必要です（現在: ${base.category}）`;
  else if (!base.bodyText) unavailableReason = '本文がありません';
  else if (header && !['TEXT', 'DOCUMENT'].includes(header.format?.toUpperCase() || '')) unavailableReason = 'この見出し形式には未対応です';
  else if (buttons.some((button) => !['URL', 'PHONE_NUMBER', 'QUICK_REPLY'].includes(button.type?.toUpperCase() || ''))) unavailableReason = 'このボタン形式には未対応です';
  else if (urlButtons.some((button) => !button.url.startsWith('https://') || (button.dynamic && !/^https:\/\/[^{}]+\{\{1\}\}$/.test(button.url)))) unavailableReason = 'URLボタンはHTTPS・末尾の変数1個に対応しています';
  else if (base.parameters.length > 32) unavailableReason = '変数が多すぎます';
  const urlKeys: readonly string[] = definition && 'urlKeys' in definition ? definition.urlKeys : [];
  return {
    ...base, label: definition?.label || base.name, documentRequired, urlButtons,
    parameters: base.parameters.map((item) => ({ ...item,
      label: item.component === 'body' && definition ? definition.fields[item.index - 1] || item.label : item.label,
      isUrl: urlKeys.includes(item.key),
    })),
    available: unavailableReason === null, unavailableReason,
  };
}
export type OperationalTemplate = NonNullable<ReturnType<typeof operationalTemplate>>;

export async function listOperationalTemplates(account: LineAccount) {
  const list = (await fetchWhatsAppTemplateDefinitions(account)).map(operationalTemplate)
    .filter((item): item is OperationalTemplate => item !== null);
  // Show requested operational purposes even during Meta review or before registration.
  for (const definition of OPERATIONAL_TEMPLATES) {
    if (!list.some((item) => item.name === definition.name && item.language === 'en_US')) {
      list.push(operationalTemplate({ name: definition.name, language: 'en_US', status: 'NOT_REGISTERED', category: 'UTILITY',
        components: [...(definition.document ? [{ type: 'HEADER', format: 'DOCUMENT' }] : []), { type: 'BODY', text: definition.body }] })!);
    }
  }
  return list.sort((a, b) => Number(!OPERATIONAL_TEMPLATES.some((t) => t.name === a.name)) - Number(!OPERATIONAL_TEMPLATES.some((t) => t.name === b.name)));
}

export function httpsUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('URLを正しく入力してください'); }
  if (url.protocol !== 'https:' || url.username || url.password || /[\s\x00-\x1f]/.test(value) || !url.hostname.includes('.')) {
    throw new Error('URLはユーザー情報を含まないHTTPSで入力してください');
  }
  return value;
}

function textValue(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}を入力してください`);
  const normalized = value.trim();
  if (normalized.length > 512 || /[\r\n\t\x00-\x1f]| {5}|{{|}}/.test(normalized)) throw new Error(`${label}は改行なし・512文字以内で入力してください`);
  return normalized;
}

export function prepareOperationalMessage(template: OperationalTemplate, values: Record<string, string>, buttonValues: Record<string, string>) {
  if (!template.available) throw new Error(template.unavailableReason || '使用できないテンプレートです');
  if (!values || typeof values !== 'object' || Array.isArray(values) || !buttonValues || typeof buttonValues !== 'object' || Array.isArray(buttonValues)) throw new Error('変数の形式が正しくありません');
  const keys = new Set(template.parameters.map((item) => item.key));
  if (Object.keys(values).some((key) => !keys.has(key))) throw new Error('未定義の変数です');
  const normalized: Record<string, string> = {};
  for (const parameter of template.parameters) {
    const value = textValue(values[parameter.key], parameter.label);
    normalized[parameter.key] = parameter.isUrl ? httpsUrl(value) : value;
  }
  const dynamicButtons = template.urlButtons.filter((item) => item.dynamic);
  if (Object.keys(buttonValues).some((key) => !dynamicButtons.some((item) => String(item.index) === key))) throw new Error('未定義のURLボタンです');
  const buttonParameters: Record<string, string> = {};
  const links = template.urlButtons.map((button) => {
    if (!button.dynamic) return { label: button.label, url: httpsUrl(button.url) };
    const suffix = textValue(buttonValues[String(button.index)], button.label);
    const url = httpsUrl(button.url.replace('{{1}}', () => suffix));
    if (new URL(url).origin !== new URL(button.url.replace('{{1}}', '')).origin) throw new Error('URLの送信先は変更できません');
    buttonParameters[String(button.index)] = suffix;
    return { label: button.label, url };
  });
  const replace = (text: string, component: string) => text.replace(/{{\s*([^}]+?)\s*}}/g, (_match, name: string) => normalized[`${component}:${name}`] ?? _match);
  const body = replace(template.bodyText, 'body');
  if (body.length > 1024) throw new Error('完成した本文は1024文字以内にしてください');
  const text = [template.headerText && replace(template.headerText, 'header'), body, template.footerText,
    ...links.map((link) => `${link.label}: ${link.url}`)].filter(Boolean).join('\n\n');
  return { values: normalized, buttonValues: buttonParameters, text, links };
}

export function operationalPayload(phone: string, template: OperationalTemplate, message: ReturnType<typeof prepareOperationalMessage>, document?: { id: string; filename: string }) {
  if (template.documentRequired !== Boolean(document)) throw new Error('PDF添付を確認してください');
  const components: Record<string, unknown>[] = [];
  if (document) components.push({ type: 'header', parameters: [{ type: 'document', document }] });
  for (const component of ['header', 'body']) {
    const parameters = template.parameters.filter((item) => item.component === component).map((item) => ({
      type: 'text', text: message.values[item.key], ...(item.name ? { parameter_name: item.name } : {}),
    }));
    if (parameters.length) components.push({ type: component, parameters });
  }
  for (const [index, text] of Object.entries(message.buttonValues)) components.push({ type: 'button', sub_type: 'url', index, parameters: [{ type: 'text', text }] });
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'template',
    template: { name: template.name, language: { code: template.language }, components } };
}
