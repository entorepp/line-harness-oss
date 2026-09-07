import type { Env } from '../index.js';
import {
  dispatchOutboundMessage,
  getMessagingFriendContext,
} from './outbound-messages.js';
import { extractSingleQuoteReference } from './quote-reference.js';
export { extractSingleQuoteReference } from './quote-reference.js';

const ALLOWED_CHANNELS = new Set(['line', 'whatsapp', 'wechat', 'messenger', 'instagram']);

type QuoteResolution = {
  status: 'ready' | 'preparing' | 'not_found';
  quoteReference: string;
  downloadUrl?: string;
  fileName?: string;
};

function enabled(env: Env['Bindings']): boolean {
  return env.QUOTE_CHAT_DELIVERY_ENABLED?.trim().toLowerCase() === 'true';
}

async function claimDeliveryReceipt(
  db: D1Database,
  channel: string,
  providerMessageId: string,
  quoteReference: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO quote_delivery_receipts
         (channel, provider_message_id, quote_reference, status, created_at, updated_at)
       VALUES (?, ?, ?, 'processing', datetime('now'), datetime('now'))`,
    )
    .bind(channel, providerMessageId, quoteReference)
    .run();
  return Boolean(result.meta.changes);
}

async function finalizeDeliveryReceipt(
  db: D1Database,
  channel: string,
  providerMessageId: string,
  status: string,
  revision = '',
): Promise<void> {
  await db
    .prepare(
      `UPDATE quote_delivery_receipts
          SET status = ?, quote_revision = ?, updated_at = datetime('now')
        WHERE channel = ? AND provider_message_id = ?`,
    )
    .bind(status, revision, channel, providerMessageId)
    .run();
}

async function releaseDeliveryReceipt(
  db: D1Database,
  channel: string,
  providerMessageId: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM quote_delivery_receipts WHERE channel = ? AND provider_message_id = ?`)
    .bind(channel, providerMessageId)
    .run();
}

function customerReply(result: QuoteResolution): string {
  if (result.status === 'ready' && result.downloadUrl) {
    return [
      'Your Flat Travel quotation is ready.',
      `Reference: ${result.quoteReference}`,
      `PDF (valid for 10 minutes): ${result.downloadUrl}`,
      'Prices and availability may change until confirmation.',
    ].join('\n');
  }
  if (result.status === 'preparing') {
    return [
      `We found your request (${result.quoteReference}).`,
      'Your quotation is still being prepared. Our team will let you know when it is ready.',
    ].join('\n');
  }
  return [
    `We could not find a customer-ready quotation for ${result.quoteReference}.`,
    'Please check the reference number or contact our team.',
  ].join('\n');
}

export async function tryDeliverCustomerQuote(opts: {
  env: Env['Bindings'];
  friendId: string;
  channel: string;
  providerMessageId: string;
  text: string;
  replyText?: (text: string) => Promise<void>;
}): Promise<boolean> {
  if (!enabled(opts.env) || !ALLOWED_CHANNELS.has(opts.channel)) return false;
  const reference = extractSingleQuoteReference(opts.text);
  if (!reference || !opts.providerMessageId.trim()) return false;
  const baseUrl = opts.env.FLATWORKER_API_BASE_URL?.replace(/\/+$/, '');
  const token = opts.env.FLATWORKER_TRAVEL_QUOTE_TOKEN?.trim();
  if (!baseUrl || !token) {
    console.error('Quote chat delivery is enabled but FlatWorker resolver credentials are unavailable');
    return false;
  }
  const claimed = await claimDeliveryReceipt(
    opts.env.DB,
    opts.channel,
    opts.providerMessageId,
    reference,
  );
  if (!claimed) return true;
  try {
    const response = await fetch(`${baseUrl}/api/integrations/quote-delivery/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Flat-Travel-Quote-Token': token,
      },
      body: JSON.stringify({
        quoteReference: reference,
        channel: opts.channel,
        providerMessageId: opts.providerMessageId,
      }),
    });
    if (!response.ok) {
      throw new Error(`FlatWorker quote resolver returned ${response.status}`);
    }
    const result = await response.json() as QuoteResolution & { revision?: string };
    if (!['ready', 'preparing', 'not_found'].includes(result.status) || result.quoteReference !== reference) {
      throw new Error('FlatWorker quote resolver returned an invalid projection');
    }
    const reply = customerReply(result);
    if (opts.replyText) {
      await opts.replyText(reply);
    } else {
      const friend = await getMessagingFriendContext(opts.env.DB, opts.friendId);
      if (!friend) throw new Error('Quote delivery recipient is unavailable');
      await dispatchOutboundMessage({
        env: opts.env,
        friend,
        input: { messageType: 'text', content: reply },
      });
    }
    await opts.env.DB
      .prepare(
        `INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, created_at)
         VALUES (?, ?, 'outgoing', 'text', ?, datetime('now'))`,
      )
      .bind(crypto.randomUUID(), opts.friendId, reply)
      .run();
    await finalizeDeliveryReceipt(
      opts.env.DB,
      opts.channel,
      opts.providerMessageId,
      result.status,
      result.revision || '',
    );
    return true;
  } catch (error) {
    await releaseDeliveryReceipt(opts.env.DB, opts.channel, opts.providerMessageId).catch(() => undefined);
    console.error('Quote chat delivery failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
}
