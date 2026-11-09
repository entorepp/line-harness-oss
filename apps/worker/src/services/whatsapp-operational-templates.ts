import type { LineAccount } from '@line-crm/db';
import { whatsappRecipientFields } from './whatsapp-recipient.js';
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
  { name: 'flat_travel_requested_info_ready_v1', label: '依頼された案内の準備完了・会話再開', document: false,
    body: 'Hello {{1}}, the travel information you requested for Flat Travel enquiry {{2}} is ready. Tap Continue chat to receive the details here.',
    fields: ['お客様名', '問合せ番号'], examples: ['Alex Example', 'SAMPLE-ENQUIRY-001'],
    quickReplies: ['Continue chat'] },
  { name: 'flat_travel_requested_quote_v2', label: '依頼された見積り', document: true,
    body: 'Hello {{1}}, the quotation you requested from Flat Travel is attached. Please review the itinerary, price and conditions in the document. Reply to this message with any questions about your quotation.',
    fields: ['お客様名'], examples: ['Alex Example'] },
  // Customer journey notices (2026-11). Fixed copy without variables; G3 adds its survey link as a URL button.
  { name: 'flat_travel_enquiry_received_v1', label: 'A1 初回お礼', document: false,
    body: 'Thank you for contacting Flat Travel!\nWe’ve received your request and will prepare a quote based on your needs. We usually send the first quote within a few business days.\nIf there’s anything else you’d like us to know (accessibility needs, must-see places, budget), just reply here.',
    fields: [], examples: [] },
  { name: 'flat_travel_call_offer_v1', label: 'A2 通話の案内', document: false,
    body: 'If you’d like to talk things through, we’d be happy to have a short call.\nCould you let us know a convenient time from tomorrow onwards, along with your time zone?\nA call isn’t required. We’re also happy to arrange everything by message.',
    fields: [], examples: [] },
  { name: 'flat_travel_updated_quote_v1', label: 'B2 見積り修正版の送付', document: true,
    body: 'We’ve updated your quote based on your feedback. Please have a look at the attached file.\nPlease note that prices may change slightly depending on exchange rates and availability.',
    fields: [], examples: [] },
  { name: 'flat_travel_price_feedback_v1', label: 'B3 「高い」と言われたとき', document: false,
    body: 'Thank you for your honest feedback. Accessible rooms in Japan are limited and usually priced higher than standard rooms, especially in Tokyo.\nOur quote is a full package: we check each room’s accessibility in detail, and include accessible airport transfers and Shinkansen wheelchair-seat arrangements between cities.\nIf you’d prefer, we can also adjust your quote to include only the accessible hotels. Just let us know.',
    fields: [], examples: [] },
  { name: 'flat_travel_priority_question_v1', label: 'B4 一番重視することを聞く', document: false,
    body: 'To make sure we get this right, could you tell us which matters most to you?\n① Bathroom type (walk-in shower)\n② Rooms next to each other\n③ Budget\n④ Location\nIt’s sometimes hard to meet all of these at once, so knowing your top priority helps us a lot.',
    fields: [], examples: [] },
  { name: 'flat_travel_itinerary_draft_v1', label: 'B5 旅程・チャーター行程の提案', document: true,
    body: 'Here’s a draft of your itinerary. How does this look to you?\nIf there are any other places you’d like to visit, or anything you’d like to change, please just let us know.',
    fields: [], examples: [] },
  { name: 'flat_travel_cultural_experience_v1', label: 'B6 文化体験の提案', document: true,
    body: 'Here’s a brochure of accessible cultural experiences, such as a sumo dinner show, a sushi-making class and a tea ceremony. Have a look, and let us know if you’d like to add any of them to your trip.',
    fields: [], examples: [] },
  { name: 'flat_travel_quote_reminder_1_v1', label: 'C1 見積りリマインド1回目', document: false,
    body: 'Just checking in on the quote we sent. Have you had a chance to look at it?\nPlease note that availability for the rooms in your quote may change. Happy to answer any questions or make changes.',
    fields: [], examples: [] },
  { name: 'flat_travel_quote_reminder_2_v1', label: 'C2 見積りリマインド2回目（通話の提案）', document: false,
    body: 'Sorry for the repeated message! If it would be easier to talk things through, we’d be happy to have a quick call.\nCould you let us know a convenient time from tomorrow onwards, along with your time zone?',
    fields: [], examples: [] },
  { name: 'flat_travel_quote_reminder_3_v1', label: 'C3 見積りリマインド3回目（ホテルのみの提案）', document: false,
    body: 'If the full package isn’t quite what you’re looking for, we can also adjust your quote to include only the accessible hotels. Feel free to message us anytime if you have questions.',
    fields: [], examples: [] },
  { name: 'flat_travel_reply_reminder_v1', label: 'C4 返信待ちの確認', document: false,
    body: 'Hi! Just checking in on our previous message.\nPlease feel free to share your thoughts, or please let us know if you have any questions.',
    fields: [], examples: [] },
  { name: 'flat_travel_payment_received_v1', label: 'D1 入金確認', document: false,
    body: 'Thank you! We’ve received your payment.\nWe’re so happy to be planning this trip with you! We’ll now start booking everything and will update you as each part is confirmed.',
    fields: [], examples: [] },
  { name: 'flat_travel_payment_due_reminder_v1', label: 'D2 支払い期限のリマインド', document: false,
    body: 'A quick reminder that the payment for your trip is due soon. Please check the due date on your invoice.\nLet us know once it’s done, or if you need any help with the payment.',
    fields: [], examples: [] },
  { name: 'flat_travel_arrangements_confirmed_v1', label: 'E1 手配確定書の送付', document: true,
    body: 'Good news! All your arrangements are now confirmed.\nPlease find attached the confirmations for your hotels, transfers and other bookings.\nPlease check that all names and dates are correct, and let us know if anything needs changing.',
    fields: [], examples: [] },
  { name: 'flat_travel_pre_departure_v1', label: 'F1 出発直前の案内', document: false,
    body: 'Your driver will be waiting for you in the arrival lobby, holding a name board.\nIf anything comes up, please contact us on this WhatsApp.',
    fields: [], examples: [] },
  { name: 'flat_travel_arrival_check_v1', label: 'G1 到着確認', document: false,
    body: 'Welcome to Japan! We hope your journey went well and you’ve settled into your hotel.\nIs everything OK with your room and the bathroom setup? If anything isn’t right, please message us and we’ll contact the hotel right away.',
    fields: [], examples: [] },
  { name: 'flat_travel_shinkansen_tips_v1', label: 'G2 新幹線に乗る前', document: false,
    body: 'Hope you’re enjoying your trip! When you take the Shinkansen, please have all your tickets ready, as you’ll need them to go through the ticket gate.',
    fields: [], examples: [] },
  { name: 'flat_travel_post_trip_feedback_v1', label: 'G3 帰国後のお礼・感想', document: false,
    body: 'Welcome home! Thank you so much for travelling with Flat Travel. We hope you had a wonderful time in Japan.\nWe’d love to hear how your trip went. If you have a moment, please share your feedback using the button below.',
    fields: [], examples: [] },
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
  const quickReplies = buttons.flatMap((button, index) => button.type?.toUpperCase() === 'QUICK_REPLY'
    ? [{ index, label: button.text || '返信', payload: `wa_template_reply:${base.name}:${index}` }] : []);
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
    ...base, label: definition?.label || base.name, documentRequired, urlButtons, quickReplies,
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
        components: [...(definition.document ? [{ type: 'HEADER', format: 'DOCUMENT' }] : []), { type: 'BODY', text: definition.body },
          ...('quickReplies' in definition ? [{ type: 'BUTTONS', buttons: definition.quickReplies.map((text) => ({ type: 'QUICK_REPLY', text })) }] : [])] })!);
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
  for (const button of template.quickReplies) components.push({ type: 'button', sub_type: 'quick_reply', index: String(button.index), parameters: [{ type: 'payload', payload: button.payload }] });
  return { messaging_product: 'whatsapp', recipient_type: 'individual', ...whatsappRecipientFields({ line_user_id: phone }), type: 'template',
    template: { name: template.name, language: { code: template.language }, components } };
}
