import { Hono } from 'hono';
import {
  cancelScheduledMessage,
  createScheduledMessage,
  getOperators,
  getOperatorById,
  getScheduledMessageById,
  updateScheduledMessage,
  createOperator,
  updateOperator,
  deleteOperator,
  getChats,
  getChatById,
  createChat,
  updateChat,
  jstNow,
  type ScheduledMessageRow,
} from '@line-crm/db';
import type { Env } from '../index.js';
import {
  dispatchOutboundMessage,
  getMessagingFriendContext,
  summarizeOutboundMessage,
} from '../services/outbound-messages.js';
import {
  presentWhatsappDisplayName,
} from '../services/whatsapp-display.js';
import { normalizeFutureScheduledAt } from '../services/schedule-validation.js';
import { replaceEmojiShortcodes } from '@line-crm/shared';

const chats = new Hono<Env>();
const DEFAULT_MESSAGE_PAGE_SIZE = 200;
const MAX_MESSAGE_PAGE_SIZE = 200;

type MessageLogRow = {
  id: string;
  friend_id: string;
  direction: string;
  message_type: string;
  content: string;
  created_at: string;
};

function parseMessagePageSize(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MESSAGE_PAGE_SIZE;
  return Math.min(Math.max(parsed, 1), MAX_MESSAGE_PAGE_SIZE);
}

async function getMessagePage(
  db: D1Database,
  friendId: string,
  opts: { beforeMessageId?: string; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_MESSAGE_PAGE_SIZE, 1), MAX_MESSAGE_PAGE_SIZE);
  const bindings: unknown[] = [friendId];
  let beforeClause = '';

  if (opts.beforeMessageId) {
    const cursor = await db
      .prepare(`SELECT id, created_at FROM messages_log WHERE friend_id = ? AND id = ?`)
      .bind(friendId, opts.beforeMessageId)
      .first<{ id: string; created_at: string }>();

    if (!cursor) {
      return { rows: [] as MessageLogRow[], hasMore: false, oldestMessageId: null as string | null };
    }

    beforeClause = ' AND (created_at < ? OR (created_at = ? AND id < ?))';
    bindings.push(cursor.created_at, cursor.created_at, cursor.id);
  }

  const result = await db
    .prepare(
      `SELECT id, friend_id, direction, message_type, content, created_at
         FROM messages_log
        WHERE friend_id = ?${beforeClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    )
    .bind(...bindings, limit + 1)
    .all<MessageLogRow>();

  const rows = result.results.slice(0, limit).reverse();

  return {
    rows,
    hasMore: result.results.length > limit,
    oldestMessageId: rows[0]?.id ?? null,
  };
}

function serializeScheduledMessage(row: ScheduledMessageRow) {
  return {
    id: row.id,
    friendId: row.friend_id,
    chatId: row.chat_id,
    messageType: row.message_type,
    content: row.content,
    metadata: row.metadata,
    scheduledAt: row.scheduled_at,
    status: row.status,
    sentAt: row.sent_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeScheduleMetadata(body: {
  fileName?: string;
  fileSize?: string;
  fileIcon?: string;
}): string | null {
  if (!body.fileName && !body.fileSize && !body.fileIcon) {
    return null;
  }

  return JSON.stringify({
    fileName: body.fileName ?? null,
    fileSize: body.fileSize ?? null,
    fileIcon: body.fileIcon ?? null,
  });
}

// ========== オペレーターCRUD ==========

chats.get('/api/operators', async (c) => {
  try {
    const items = await getOperators(c.env.DB);
    return c.json({
      success: true,
      data: items.map((o) => ({
        id: o.id,
        name: o.name,
        email: o.email,
        role: o.role,
        isActive: Boolean(o.is_active),
        createdAt: o.created_at,
        updatedAt: o.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/operators', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; role?: string }>();
    if (!body.name || !body.email) return c.json({ success: false, error: 'name and email are required' }, 400);
    const item = await createOperator(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, email: item.email, role: item.role } }, 201);
  } catch (err) {
    console.error('POST /api/operators error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/operators/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOperator(c.env.DB, id, body);
    const updated = await getOperatorById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/operators/:id', async (c) => {
  try {
    await deleteOperator(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/operators/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チャットCRUD ==========

chats.get('/api/chats', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const operatorId = c.req.query('operatorId') ?? undefined;
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;

    // JOIN friends to get display_name and picture_url
    let sql = `SELECT c.*, f.display_name, f.picture_url, f.line_user_id, la.channel_type,
                      (
                        SELECT ml.id
                          FROM messages_log ml
                         WHERE ml.friend_id = c.friend_id
                         ORDER BY ml.created_at DESC, ml.id DESC
                         LIMIT 1
                      ) as last_message_id,
                      (
                        SELECT ml.direction
                          FROM messages_log ml
                         WHERE ml.friend_id = c.friend_id
                         ORDER BY ml.created_at DESC, ml.id DESC
                         LIMIT 1
                      ) as last_message_direction
               FROM chats c
               LEFT JOIN friends f ON c.friend_id = f.id
               LEFT JOIN line_accounts la ON la.id = f.line_account_id`;
    const conditions: string[] = [];
    const bindings: unknown[] = [];

    if (status) {
      conditions.push('c.status = ?');
      bindings.push(status);
    }
    if (operatorId) {
      conditions.push('c.operator_id = ?');
      bindings.push(operatorId);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      bindings.push(lineAccountId);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY c.last_message_at DESC';

    const stmt = bindings.length > 0
      ? c.env.DB.prepare(sql).bind(...bindings)
      : c.env.DB.prepare(sql);
    const result = await stmt.all();

    return c.json({
      success: true,
      data: result.results.map((ch: Record<string, unknown>) => ({
        id: ch.id,
        friendId: ch.friend_id,
        friendName:
          ch.channel_type === 'whatsapp'
            ? presentWhatsappDisplayName(
                typeof ch.display_name === 'string' ? ch.display_name : null,
                typeof ch.line_user_id === 'string' ? ch.line_user_id : '',
              ) || '名前なし'
            : ch.display_name || '名前なし',
        friendPictureUrl: ch.picture_url || null,
        operatorId: ch.operator_id,
        status: ch.status,
        notes: ch.notes,
        lastMessageAt: ch.last_message_at,
        lastMessageId: ch.last_message_id || null,
        lastMessageDirection:
          ch.last_message_direction === 'incoming' || ch.last_message_direction === 'outgoing'
            ? ch.last_message_direction
            : null,
        createdAt: ch.created_at,
        updatedAt: ch.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.get('/api/chats/:id', async (c) => {
  try {
    const item = await getChatById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Chat not found' }, 404);
    const limit = parseMessagePageSize(c.req.query('limit'));
    const beforeMessageId = c.req.query('beforeMessageId') ?? undefined;

    // 友だち情報を取得
    const friend = await c.env.DB
      .prepare(
        `SELECT f.display_name, f.picture_url, f.line_user_id, f.slack_channel_id, la.channel_type
           FROM friends f
           LEFT JOIN line_accounts la ON la.id = f.line_account_id
          WHERE f.id = ?`,
      )
      .bind(item.friend_id)
      .first<{
        display_name: string | null;
        picture_url: string | null;
        line_user_id: string;
        slack_channel_id: string | null;
        channel_type: string | null;
      }>();

    const messagePage = await getMessagePage(c.env.DB, item.friend_id, {
      beforeMessageId,
      limit,
    });

    return c.json({
      success: true,
      data: {
        id: item.id,
        friendId: item.friend_id,
        friendName:
          friend?.channel_type === 'whatsapp'
            ? presentWhatsappDisplayName(friend.display_name, friend.line_user_id) || '名前なし'
            : friend?.display_name || '名前なし',
        friendPictureUrl: friend?.picture_url || null,
        slackChannelId: friend?.slack_channel_id || null,
        operatorId: item.operator_id,
        status: item.status,
        notes: item.notes,
        lastMessageAt: item.last_message_at,
        createdAt: item.created_at,
        messages: messagePage.rows.map((m) => ({
          id: m.id,
          direction: m.direction,
          messageType: m.message_type,
          content: m.content,
          createdAt: m.created_at,
        })),
        hasMoreMessages: messagePage.hasMore,
        oldestMessageId: messagePage.oldestMessageId,
      },
    });
  } catch (err) {
    console.error('GET /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.post('/api/chats', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; operatorId?: string; lineAccountId?: string | null }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const item = await createChat(c.env.DB, body);
    // Save line_account_id if provided
    if (body.lineAccountId) {
      await c.env.DB.prepare(`UPDATE chats SET line_account_id = ? WHERE id = ?`)
        .bind(body.lineAccountId, item.id).run();
    }
    return c.json({ success: true, data: { id: item.id, friendId: item.friend_id, status: item.status } }, 201);
  } catch (err) {
    console.error('POST /api/chats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// チャットのアサイン/ステータス更新/ノート更新
chats.put('/api/chats/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ operatorId?: string | null; status?: string; notes?: string }>();
    await updateChat(c.env.DB, id, body);
    const updated = await getChatById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: updated.id, friendId: updated.friend_id, operatorId: updated.operator_id, status: updated.status, notes: updated.notes },
    });
  } catch (err) {
    console.error('PUT /api/chats/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// オペレーターからメッセージ送信
chats.post('/api/chats/:id/send', async (c) => {
  try {
    const chatId = c.req.param('id');
    const chat = await getChatById(c.env.DB, chatId);
    if (!chat) return c.json({ success: false, error: 'Chat not found' }, 404);

    const body = await c.req.json<{
      messageType?: string;
      content: string;
      fileName?: string;
      fileSize?: string;
      fileIcon?: string;
      scheduledAt?: string | null;
    }>();
    if (!body.content) return c.json({ success: false, error: 'content is required' }, 400);

    const friend = await getMessagingFriendContext(c.env.DB, chat.friend_id);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const messageType = body.messageType ?? 'text';
    const content = messageType === 'text' ? replaceEmojiShortcodes(body.content) : body.content;

    if (body.scheduledAt) {
      const normalizedSchedule = normalizeFutureScheduledAt(body.scheduledAt);
      if (!normalizedSchedule.ok) {
        return c.json({ success: false, error: normalizedSchedule.error }, 400);
      }

      const scheduled = await createScheduledMessage(c.env.DB, {
        friendId: friend.id,
        chatId,
        messageType,
        content,
        metadata: serializeScheduleMetadata(body),
        scheduledAt: normalizedSchedule.scheduledAt,
      });

      return c.json({
        success: true,
        data: {
          scheduled: true,
          scheduledMessage: serializeScheduledMessage(scheduled),
        },
      }, 201);
    }

    const now = jstNow();
    const dispatchResult = await dispatchOutboundMessage({
      env: c.env,
      friend,
      input: {
        messageType,
        content,
        fileName: body.fileName,
        fileSize: body.fileSize,
        fileIcon: body.fileIcon,
      },
    });

    // メッセージログに記録
    const logId = crypto.randomUUID();
    await c.env.DB
      .prepare(`INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at) VALUES (?, ?, 'outgoing', ?, ?, ?)`)
      .bind(logId, friend.id, dispatchResult.messageType, dispatchResult.storedContent, now)
      .run();

    // チャットの最終メッセージ日時を更新
    await updateChat(c.env.DB, chatId, { status: 'in_progress', lastMessageAt: now });

    // Slack通知
    if (c.env.SLACK_BOT_TOKEN && ['text', 'image', 'file', 'sticker'].includes(dispatchResult.messageType)) {
      const friendInfo = await c.env.DB.prepare(
        `SELECT f.display_name, f.slack_channel_id,
                la.name as account_name, la.locale, la.default_slack_channel
         FROM friends f LEFT JOIN line_accounts la ON la.id = f.line_account_id WHERE f.id = ?`
      ).bind(friend.id).first<{
        display_name: string;
        slack_channel_id: string | null;
        account_name: string | null;
        locale: string | null;
        default_slack_channel: string | null;
      }>();
      if (friendInfo) {
        const { notifySlackOutgoing, resolveSlackChannelId } = await import('../services/slack.js');
        await notifySlackOutgoing({
          slackToken: c.env.SLACK_BOT_TOKEN,
          slackChannelId: resolveSlackChannelId(
            friendInfo.slack_channel_id,
            friendInfo.default_slack_channel,
          ),
          friendName: friendInfo.display_name || 'Unknown',
          messageText: summarizeOutboundMessage(dispatchResult.messageType, dispatchResult.storedContent),
          accountName: friendInfo.account_name || undefined,
          locale: friendInfo.locale,
        }).catch((err) => console.error('Slack outgoing notification error:', err));
      }
    }

    return c.json({ success: true, data: { sent: true, messageId: logId } });
  } catch (err) {
    console.error('POST /api/chats/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.delete('/api/scheduled-messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getScheduledMessageById(c.env.DB, id);
    if (!item) return c.json({ success: false, error: 'Scheduled message not found' }, 404);
    if (item.status === 'sent') {
      return c.json({ success: false, error: 'Sent scheduled messages cannot be cancelled' }, 400);
    }

    await cancelScheduledMessage(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/scheduled-messages/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

chats.put('/api/scheduled-messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getScheduledMessageById(c.env.DB, id);
    if (!item) return c.json({ success: false, error: 'Scheduled message not found' }, 404);
    if (item.status === 'sent') {
      return c.json({ success: false, error: 'Sent scheduled messages cannot be updated' }, 400);
    }
    if (item.status === 'sending') {
      return c.json({ success: false, error: 'Sending scheduled messages cannot be updated' }, 400);
    }

    const body = await c.req.json<{ scheduledAt?: string | null }>();
    if (!body.scheduledAt) {
      return c.json({ success: false, error: 'scheduledAt is required' }, 400);
    }

    const normalizedSchedule = normalizeFutureScheduledAt(body.scheduledAt);
    if (!normalizedSchedule.ok) {
      return c.json({ success: false, error: normalizedSchedule.error }, 400);
    }

    const updated = await updateScheduledMessage(c.env.DB, id, {
      scheduledAt: normalizedSchedule.scheduledAt,
    });
    if (!updated) {
      return c.json({ success: false, error: 'Scheduled message not found' }, 404);
    }

    return c.json({
      success: true,
      data: serializeScheduledMessage(updated),
    });
  } catch (err) {
    console.error('PUT /api/scheduled-messages/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { chats };
