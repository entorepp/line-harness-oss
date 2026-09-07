import {
  claimScheduledMessage,
  createChat,
  getChatByFriendId,
  getDueScheduledMessages,
  getScheduledMessageById,
  jstNow,
  updateChat,
  updateScheduledMessageStatus,
} from '@line-crm/db';
import type { Env } from '../index.js';
import {
  dispatchOutboundMessage,
  getMessagingFriendContext,
  summarizeOutboundMessage,
} from './outbound-messages.js';
import { notifySlackOutgoing, resolveSlackChannelId } from './slack.js';

function parseMetadata(metadata: string | null): {
  fileName?: string | null;
  fileSize?: string | null;
  fileIcon?: string | null;
} {
  if (!metadata) return {};

  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    return {
      fileName: typeof parsed.fileName === 'string' ? parsed.fileName : null,
      fileSize: typeof parsed.fileSize === 'string' ? parsed.fileSize : null,
      fileIcon: typeof parsed.fileIcon === 'string' ? parsed.fileIcon : null,
    };
  } catch {
    return {};
  }
}

export async function processScheduledMessages(
  env: Env['Bindings'],
): Promise<void> {
  const dueItems = await getDueScheduledMessages(env.DB, jstNow(), 100);

  for (const item of dueItems) {
    await processScheduledMessageById(env, item.id);
  }
}

export type ScheduledMessageProcessResult =
  | 'sent'
  | 'already-processing'
  | 'not-due'
  | 'not-found'
  | 'cancelled'
  | 'failed';

export async function processScheduledMessageById(
  env: Env['Bindings'],
  id: string,
): Promise<ScheduledMessageProcessResult> {
  const item = await getScheduledMessageById(env.DB, id);
  if (!item) return 'not-found';
  if (item.status === 'sent') return 'sent';
  if (item.status === 'sending') return 'already-processing';
  if (item.status === 'cancelled') return 'cancelled';
  if (item.status !== 'scheduled') return 'failed';

  const scheduledTime = new Date(item.scheduled_at).getTime();
  if (!Number.isFinite(scheduledTime) || scheduledTime > Date.now()) {
    return 'not-due';
  }

  const claimed = await claimScheduledMessage(env.DB, item.id);
  if (!claimed) {
    const latest = await getScheduledMessageById(env.DB, item.id);
    if (latest?.status === 'sent') return 'sent';
    if (latest?.status === 'sending') return 'already-processing';
    if (latest?.status === 'cancelled') return 'cancelled';
    return latest ? 'failed' : 'not-found';
  }

  try {
    const friend = await getMessagingFriendContext(env.DB, item.friend_id);
    if (!friend) {
      throw new Error('Friend not found');
    }

    const metadata = parseMetadata(item.metadata);
    const { messageType, storedContent } = await dispatchOutboundMessage({
      env,
      friend,
      input: {
        messageType: item.message_type,
        content: item.content,
        fileName: metadata.fileName,
        fileSize: metadata.fileSize,
        fileIcon: metadata.fileIcon,
      },
    });

    const now = jstNow();
    await updateScheduledMessageStatus(env.DB, item.id, 'sent', {
      sentAt: now,
      lastError: null,
    });

    try {
      const logId = crypto.randomUUID();
      await env.DB
        .prepare(
          `INSERT INTO messages_log
             (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, ?)`,
        )
        .bind(logId, friend.id, messageType, storedContent, now)
        .run();

      const existingChat = item.chat_id
        ? await env.DB
            .prepare(`SELECT id FROM chats WHERE id = ?`)
            .bind(item.chat_id)
            .first<{ id: string }>()
        : await getChatByFriendId(env.DB, friend.id);

      if (existingChat?.id) {
        await updateChat(env.DB, existingChat.id, {
          status: 'in_progress',
          lastMessageAt: now,
        });
      } else {
        const newChat = await createChat(env.DB, { friendId: friend.id });
        await updateChat(env.DB, newChat.id, {
          status: 'in_progress',
          lastMessageAt: now,
        });
      }
    } catch (sideEffectErr) {
      console.error(`Scheduled message ${item.id} delivered but post-send bookkeeping failed:`, sideEffectErr);
    }

    if (env.SLACK_BOT_TOKEN && ['text', 'image', 'file', 'sticker'].includes(messageType)) {
      try {
        const friendInfo = await env.DB.prepare(
          `SELECT f.display_name, f.slack_channel_id,
                  la.name as account_name, la.locale, la.default_slack_channel
             FROM friends f
             LEFT JOIN line_accounts la ON la.id = f.line_account_id
            WHERE f.id = ?`,
        ).bind(friend.id).first<{
          display_name: string;
          slack_channel_id: string | null;
          account_name: string | null;
          locale: string | null;
          default_slack_channel: string | null;
        }>();

        if (friendInfo) {
          await notifySlackOutgoing({
            slackToken: env.SLACK_BOT_TOKEN,
            slackChannelId: resolveSlackChannelId(
              friendInfo.slack_channel_id,
              friendInfo.default_slack_channel,
            ),
            friendName: friendInfo.display_name || 'Unknown',
            messageText: summarizeOutboundMessage(messageType, storedContent),
            accountName: friendInfo.account_name || undefined,
            locale: friendInfo.locale,
          });
        }
      } catch (slackErr) {
        console.error(`Scheduled message ${item.id} delivered but Slack notification failed:`, slackErr);
      }
    }

    return 'sent';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Failed to process scheduled message ${item.id}:`, err);

    const latest = await getScheduledMessageById(env.DB, item.id);
    if (latest?.status === 'sending') {
      await updateScheduledMessageStatus(env.DB, item.id, 'failed', {
        lastError: message,
      });
    }
    return 'failed';
  }
}
