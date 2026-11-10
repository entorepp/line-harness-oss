/** Dedicated, server-to-server FW quotation channel. No generic provider proxy. */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';
import { getMessagingFriendContext, dispatchOutboundMessage } from '../services/outbound-messages.js';
import { whatsappRecipientFields } from '../services/whatsapp-recipient.js';
import { WhatsappSendError } from '../services/whatsapp-send-error.js';
import { WhatsappReplyWindowError } from '../services/whatsapp-reply-window.js';
import { getWhatsappReplyWindow } from '../services/whatsapp-reply-window.js';
import { recordWhatsappDelivery } from '../services/whatsapp-delivery.js';
import { whatsappTemplates } from './whatsapp-templates.js';

export const fwWhatsapp = new Hono<Env>();
const BASE = '/api/integrations/fw-whatsapp';
class BridgeError extends Error { constructor(message:string, readonly notStarted:boolean) { super(message); } }
const hash = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
/** Templates FW may send: the quotation plus the customer journey notices (2026-11). pdfName is the file name the customer sees.
 * link pins the only URL button a template may carry, so a definition edited at Meta cannot send customers elsewhere. */
const QUOTE_TEMPLATE = 'flat_travel_requested_quote_v2';
const FW_TEMPLATES: Record<string, { pdfName?: string; link?: string }> = {
  [QUOTE_TEMPLATE]: { pdfName: 'quotation.pdf' },
  flat_travel_enquiry_received_v1: {}, flat_travel_call_offer_v2: {},
  flat_travel_updated_quote_v1: { pdfName: 'updated-quotation.pdf' }, flat_travel_price_feedback_v2: {},
  flat_travel_priority_question_v2: {}, flat_travel_itinerary_draft_v1: { pdfName: 'itinerary.pdf' },
  flat_travel_cultural_experience_v2: { pdfName: 'cultural-experiences.pdf' },
  flat_travel_quote_reminder_1_v1: {}, flat_travel_quote_reminder_2_v2: {}, flat_travel_quote_reminder_3_v2: {},
  flat_travel_reply_reminder_v2: {}, flat_travel_payment_received_v1: {}, flat_travel_payment_due_reminder_v1: {},
  flat_travel_arrangements_confirmed_v1: { pdfName: 'booking-confirmations.pdf' }, flat_travel_pre_departure_v1: {},
  flat_travel_arrival_check_v1: {}, flat_travel_shinkansen_tips_v1: {},
  flat_travel_post_trip_feedback_v1: { link: 'https://liffform-studio.pages.dev/public-form?id=8dc19365-8dd7-49e7-92fb-fdd697572771&lang=en&issue={{1}}' },
};
const fwTemplate = (name: unknown) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(FW_TEMPLATES, name) ? name : null;
const buttonsExpected = (name: string, t: any) => {
  const buttons = t?.urlButtons || []; const link = FW_TEMPLATES[name].link;
  return link ? buttons.length === 1 && buttons[0].dynamic && buttons[0].url === link : buttons.length === 0;
};
const linkValid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
const pdfNameValid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,90}\.pdf$/.test(s);
const idValid = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(s);
async function contact(env: Env['Bindings'], id: string) {
  if (!idValid(id)) throw new Error('invalid_contact');
  const row = await env.DB.prepare(`SELECT f.id, f.display_name, f.is_following, a.name AS account_name, a.is_active
    FROM friends f JOIN line_accounts a ON a.id=f.line_account_id WHERE f.id=? AND a.channel_type='whatsapp'`).bind(id)
    .first<{id: string; display_name: string; is_following: number; account_name: string; is_active: number}>();
  const friend = await getMessagingFriendContext(env.DB, id);
  if (!row?.is_active || !row.is_following || !friend || friend.channel_type !== 'whatsapp') throw new Error('contact_unavailable');
  const recipient = whatsappRecipientFields(friend);
  const address = 'to' in recipient ? '+' + recipient.to : recipient.recipient;
  return { friend, view: { id, name: row.display_name, accountId: friend.line_account_id,
    accountName: row.account_name, address,
    fingerprint: await hash(JSON.stringify([id, friend.line_account_id, friend.channel_id, recipient])),
    window: await getWhatsappReplyWindow(env.DB, id) } };
}
async function templateCall(env: Env['Bindings'], id: string, path: string, body?: unknown) {
  const response = await whatsappTemplates.fetch(new Request(`https://internal/api/whatsapp/friends/${id}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    ...(body instanceof FormData ? { body } : body === undefined ? {} : {headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)}),
  }), env);
  const result = await response.json() as any;
  if (!response.ok || !result.success) throw new BridgeError(result.error || 'template_unavailable',result.outcome==='not_started');
  return result.data;
}
fwWhatsapp.use(`${BASE}/*`, bodyLimit({ maxSize: 14 * 1024 * 1024, onError: c => c.json({error:'payload_too_large'},413) }));
fwWhatsapp.get(`${BASE}/contacts`, async c => {
  const query = (c.req.query('q') || '').trim();
  if (query.length < 2 || query.length > 100) return c.json({contacts: []});
  const digits = query.replace(/[+\s().-]/g,'');
  const phoneQuery = /^\d{2,15}$/.test(digits) ? digits : query;
  const rows = await c.env.DB.prepare(`SELECT f.id FROM friends f JOIN line_accounts a ON a.id=f.line_account_id
    WHERE a.channel_type='whatsapp' AND a.is_active=1 AND f.is_following=1
    AND (instr(lower(f.display_name),lower(?))>0 OR instr(f.line_user_id,?)>0) ORDER BY f.id LIMIT 21`).bind(query,phoneQuery).all<{id:string}>();
  const contacts = [];
  for (const row of rows.results.slice(0,20)) {
    try { contacts.push((await contact(c.env,row.id)).view); } catch { /* Never invent a missing provider recipient. */ }
  }
  return c.json({contacts, hasMore:rows.results.length>20});
});
fwWhatsapp.get(`${BASE}/contacts/:id`, async c => {
  try { return c.json((await contact(c.env,c.req.param('id'))).view); }
  catch { return c.json({error:'contact_unavailable'},409); }
});
fwWhatsapp.get(`${BASE}/contacts/:id/history`, async c => {
  try {
    const ctx = await contact(c.env,c.req.param('id'));
    if (c.req.query('fingerprint') !== ctx.view.fingerprint) return c.json({error:'contact_changed'},409);
    const rows = await c.env.DB.prepare(`SELECT m.id, m.direction, m.message_type, m.created_at,
      d.status AS delivery_status, d.provider_status_at AS delivery_status_at
      FROM messages_log m LEFT JOIN whatsapp_delivery_receipts d ON d.message_log_id=m.id
      WHERE m.friend_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 101`).bind(ctx.friend.id).all();
    return c.json({contact:ctx.view, events:rows.results.slice(0,100), hasMore:rows.results.length>100});
  } catch { return c.json({error:'contact_unavailable'},409); }
});
// The FW picker: only allowlisted templates, with what each one needs. Unapproved ones are listed but unavailable.
fwWhatsapp.get(`${BASE}/contacts/:id/templates`, async c => {
  try {
    const ctx = await contact(c.env,c.req.param('id'));
    if (c.req.query('fingerprint') !== ctx.view.fingerprint) return c.json({error:'contact_changed'},409);
    const catalogue = await templateCall(c.env,ctx.friend.id,'templates');
    const templates = Object.keys(FW_TEMPLATES).map(name => {
      const t = catalogue.templates.find((x:any)=>x.name===name && x.language==='en_US');
      const registered = t && t.status !== 'NOT_REGISTERED'; const buttonsOk = !registered || buttonsExpected(name, t);
      const available = Boolean(t?.available) && buttonsOk;
      return { name, label: t?.label || name, text: t?.bodyText || '', available,
        unavailableReason: available ? null : !buttonsOk ? 'link_button_changed' : t?.unavailableReason || 'not_registered',
        documentRequired: Boolean(t?.documentRequired), customerNameRequired: name === QUOTE_TEMPLATE, linkRequired: Boolean(FW_TEMPLATES[name].link) };
    });
    return c.json({contact:ctx.view, canSend:Boolean(catalogue.canSend), templates});
  } catch { return c.json({error:'template_catalogue_unavailable'},409); }
});
fwWhatsapp.post(`${BASE}/contacts/:id/prepare-template`, async c => {
  try {
    const ctx = await contact(c.env,c.req.param('id')); const body = await c.req.json<any>();
    if (body.fingerprint !== ctx.view.fingerprint) return c.json({error:'contact_changed'},409);
    // Omitted templateName keeps the original FW quotation request working unchanged.
    const name = fwTemplate(body.templateName ?? QUOTE_TEMPLATE);
    if (!name) return c.json({error:'template_not_allowed'},400);
    const quote = name === QUOTE_TEMPLATE;
    if ((quote ? typeof body.name !== 'string' || body.name.length > 300 : body.name !== undefined)
      || (body.pdf !== undefined && (typeof body.pdf !== 'string' || body.pdf.length > 14_000_000))
      || (body.link !== undefined && !linkValid(body.link)) || (body.filename !== undefined && !pdfNameValid(body.filename))) return c.json({error:'invalid_template'},400);
    const catalogue = await templateCall(c.env,ctx.friend.id,'templates');
    const selected = catalogue.templates.find((t:any)=>t.name===name && t.language==='en_US' && t.available);
    if (!catalogue.canSend || !selected) return c.json({error:quote?'approved_quote_template_unavailable':'approved_template_unavailable'},409);
    // Variables FW cannot fill would fail at Meta; refuse before uploading anything.
    if (selected.parameters.length !== (quote ? 1 : 0)) return c.json({error:'template_definition_unsupported'},409);
    if (selected.documentRequired !== (body.pdf !== undefined)) return c.json({error:selected.documentRequired?'pdf_required':'pdf_not_allowed'},400);
    if (!buttonsExpected(name, selected)) return c.json({error:'template_definition_unsupported'},409);
    const links = selected.urlButtons;
    if ((links.length === 1) !== (body.link !== undefined)) return c.json({error:links.length?'link_required':'link_not_allowed'},400);
    let documentKey: string | null = null;
    if (selected.documentRequired) {
      const bytes = Uint8Array.from(atob(body.pdf),ch=>ch.charCodeAt(0));
      const form = new FormData(); form.set('file',new Blob([bytes],{type:'application/pdf'}),body.filename || FW_TEMPLATES[name].pdfName || 'flat-travel.pdf');
      documentKey = (await templateCall(c.env,ctx.friend.id,'documents',form)).key;
    }
    const input = {templateName:selected.name,templateLanguage:selected.language,values:quote?{'body:1':body.name}:{},
      buttonValues:links.length?{[String(links[0].index)]:body.link}:{},documentKey};
    const preview = await templateCall(c.env,ctx.friend.id,'template-preview',input);
    return c.json({contact:ctx.view, label:selected.label, text:preview.text, canSend:preview.canSend,
      template:{...input,previewToken:preview.previewToken,previewExpiresAt:preview.previewExpiresAt}});
  } catch { return c.json({error:'template_preview_unavailable'},409); }
});
fwWhatsapp.post(`${BASE}/contacts/:id/send`, async c => {
  let claimed = false; let key = ''; let started = false;
  try {
    const ctx = await contact(c.env,c.req.param('id')); const body = await c.req.json<any>();
    key = body.idempotencyKey;
    if (!/^[a-f0-9]{64}$/.test(key || '') || body.confirmed !== true || body.fingerprint !== ctx.view.fingerprint) return c.json({error:'review_required',outcome:'not_started'},409);
    const template = body.template;
    if (template) {
      if (body.optInConfirmed !== true || !fwTemplate(template.templateName) || template.templateLanguage !== 'en_US') return c.json({error:'template_confirmation_required',outcome:'not_started'},409);
    } else {
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length>3000 || typeof body.url!=='string') return c.json({error:'invalid_message',outcome:'not_started'},400);
      const url=new URL(body.url);
      if (url.origin!=='https://go.flat-travel.com' || !url.pathname.startsWith('/')) return c.json({error:'invalid_quote_url',outcome:'not_started'},400);
      if (!ctx.view.window.canSend) return c.json({error:'whatsapp_window_closed',outcome:'not_started'},409);
    }
    const digest = await hash(JSON.stringify(body));
    const existing = await c.env.DB.prepare('SELECT * FROM fw_whatsapp_sends WHERE id=?').bind(key).first<any>();
    if (existing) {
      if (existing.friend_id!==ctx.friend.id || existing.request_hash!==digest) return c.json({error:'idempotency_conflict',outcome:'unknown'},409);
      return c.json({status:existing.status,messageId:existing.message_log_id,duplicate:true});
    }
    const now = jstNow(); const logId = crypto.randomUUID();
    const result=await c.env.DB.prepare("INSERT OR IGNORE INTO fw_whatsapp_sends(id,friend_id,request_hash,status,message_log_id,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)")
      .bind(key,ctx.friend.id,digest,logId,now,now).run();
    if (result.meta.changes!==1) return c.json({error:'send_in_progress',outcome:'unknown'},409);
    claimed=true;
    if (template) {
      started=true;
      const receipt=await templateCall(c.env,ctx.friend.id,'template-messages',{...template,idempotencyKey:key,optInConfirmed:true,contentConfirmed:true});
      await c.env.DB.prepare('UPDATE fw_whatsapp_sends SET status=?,message_log_id=?,updated_at=? WHERE id=?').bind(receipt.status,receipt.messageId||logId,jstNow(),key).run();
      return c.json({status:receipt.status,messageId:receipt.messageId});
    }
    // Dispatch itself rereads the customer service window. Template sending never opens it.
    const finalContact=await contact(c.env,ctx.friend.id);
    if (finalContact.view.fingerprint!==ctx.view.fingerprint || !finalContact.view.window.canSend) throw new Error('contact_or_window_changed');
    started=true;
    const sent=await dispatchOutboundMessage({env:c.env,friend:ctx.friend,input:{messageType:'text',content:body.text+'\n\n'+body.url}});
    if (!sent.providerMessageId || !ctx.friend.line_account_id) throw new Error('unknown_outcome');
    await c.env.DB.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,?,'outgoing','text',?,?)")
      .bind(logId,ctx.friend.id,sent.storedContent,now).run();
    await recordWhatsappDelivery({db:c.env.DB,lineAccountId:ctx.friend.line_account_id,providerMessageId:sent.providerMessageId,messageLogId:logId,status:'accepted'});
    await c.env.DB.prepare('UPDATE chats SET last_message_at=?,updated_at=? WHERE friend_id=?').bind(now,now,ctx.friend.id).run();
    await c.env.DB.prepare("UPDATE fw_whatsapp_sends SET status='accepted',updated_at=? WHERE id=?").bind(jstNow(),key).run();
    return c.json({status:'accepted',messageId:logId});
  } catch (error) {
    if (error instanceof WhatsappReplyWindowError || (error instanceof WhatsappSendError && error.code==='WHATSAPP_PROVIDER_REJECTED') || (error instanceof BridgeError && error.notStarted)) started=false;
    // An uncertain provider outcome is never retried automatically, even after a lost receipt.
    if (claimed) await c.env.DB.prepare('UPDATE fw_whatsapp_sends SET status=?,updated_at=? WHERE id=?').bind(started?'unknown':'failed',jstNow(),key).run();
    return c.json({error:'whatsapp_send_unavailable',outcome:started?'unknown':'not_started'},502);
  }
});
