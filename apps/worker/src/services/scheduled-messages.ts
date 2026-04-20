import {
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
} from './outbound-messages.js';

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
    try {
      await updateScheduledMessageStatus(env.DB, item.id, 'sending');

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
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`Failed to process scheduled message ${item.id}:`, err);

      const latest = await getScheduledMessageById(env.DB, item.id);
      if (latest?.status !== 'cancelled') {
        await updateScheduledMessageStatus(env.DB, item.id, 'failed', {
          lastError: message,
        });
      }
    }
  }
}
