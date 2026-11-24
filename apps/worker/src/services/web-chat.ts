/**
 * Questions asked on a FlatWorker (FW) quotation page reach Harness as a 'web' channel.
 * The customer's browser only talks to FW; Harness receives each question from FW
 * (routes/fw-web-chat.ts) and hands each staff reply back to FW, which stores it, shows it on
 * the page and emails the customer. Text only.
 */
import type { MessagingFriendContext } from './outbound-messages.js';

export interface WebChatEnv {
  FLATWORKER_API_BASE_URL?: string;
  FLATWORKER_TRAVEL_QUOTE_TOKEN?: string;
}

export const WEB_CHAT_TEXT_LIMIT = 2000;
const REF_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** Harness keeps the conversation's FW reference as `web:<ref>` so it can never collide with another channel's user ID. */
export const webChatLineUserId = (ref: string) => `web:${ref}`;
export const webChatRefValid = (ref: unknown): ref is string => typeof ref === 'string' && REF_PATTERN.test(ref);

export function webChatRef(friend: Pick<MessagingFriendContext, 'line_user_id'>): string {
  const ref = friend.line_user_id.startsWith('web:') ? friend.line_user_id.slice(4) : '';
  if (!webChatRefValid(ref)) throw new Error('Web chat conversation reference is unavailable');
  return ref;
}

function metadataStaffName(friend: Pick<MessagingFriendContext, 'metadata'>): string {
  try {
    const parsed = JSON.parse(friend.metadata || '{}') as { staffName?: unknown };
    return typeof parsed.staffName === 'string' ? parsed.staffName.slice(0, 100) : '';
  } catch {
    return '';
  }
}

/** Hand a staff reply to FW. Succeeds only when FW answers {ok:true, messageId}; anything else is a failed send. */
export async function dispatchWebChatReply(opts: {
  env: WebChatEnv;
  friend: Pick<MessagingFriendContext, 'line_user_id' | 'metadata'>;
  text: string;
  harnessMessageId: string;
  sentAt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const base = opts.env.FLATWORKER_API_BASE_URL?.replace(/\/+$/, '');
  const token = opts.env.FLATWORKER_TRAVEL_QUOTE_TOKEN?.trim();
  if (!base || !token) throw new Error('FlatWorker web chat is not configured');
  const text = opts.text.trim();
  if (!text) throw new Error('Web chat reply is empty');
  if (text.length > WEB_CHAT_TEXT_LIMIT) throw new Error(`Web chat reply must be ${WEB_CHAT_TEXT_LIMIT} characters or fewer`);
  const ref = webChatRef(opts.friend);
  let response: Response;
  let result: { ok?: unknown; messageId?: unknown } | null;
  try {
    response = await fetch(`${base}/api/integrations/web-chat/staff-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Flat-Travel-Quote-Token': token },
      body: JSON.stringify({ ref, text, harnessMessageId: opts.harnessMessageId, sentAt: opts.sentAt, staffName: metadataStaffName(opts.friend) }),
      signal: opts.signal ?? AbortSignal.timeout(10_000),
    });
    result = await response.json().catch(() => null) as { ok?: unknown; messageId?: unknown } | null;
  } catch {
    // Never log the reply text or the conversation reference.
    throw new Error('FlatWorker did not confirm the web chat reply');
  }
  const messageId = result?.ok === true && typeof result.messageId === 'string' ? result.messageId : '';
  if (!response.ok || !messageId) throw new Error('FlatWorker did not accept the web chat reply');
  return messageId;
}
