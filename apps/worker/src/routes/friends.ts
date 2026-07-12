import { Hono } from 'hono';
import {
  getFriends,
  getFriendById,
  getFriendCount,
  addTagToFriend,
  createChat,
  createScheduledMessage,
  getChatByFriendId,
  removeTagFromFriend,
  getFriendTags,
  getScenarios,
  enrollFriendInScenario,
  jstNow,
  listScheduledMessagesByFriend,
  type ScheduledMessageRow,
  updateChat,
} from '@line-crm/db';
import type { Friend as DbFriend, Tag as DbTag } from '@line-crm/db';
import { replaceEmojiShortcodes } from '@line-crm/shared';
import { fireEvent } from '../services/event-bus.js';
import type { Env } from '../index.js';
import {
  dispatchOutboundMessage,
  getMessagingFriendContext,
} from '../services/outbound-messages.js';
import {
  formatWhatsappPhoneForDisplay,
  presentWhatsappDisplayName,
} from '../services/whatsapp-display.js';
import { normalizeFutureScheduledAt } from '../services/schedule-validation.js';

const friends = new Hono<Env>();

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

type FriendRowWithChannel = DbFriend & {
  channel_type?: string | null;
}

/** Convert a D1 snake_case Friend row to the shared camelCase shape */
function serializeFriend(row: FriendRowWithChannel) {
  const isWhatsApp = row.channel_type === 'whatsapp'
  const isKakao = row.channel_type === 'kakao'
  const metadata = JSON.parse(row.metadata || '{}') as Record<string, unknown>
  const lineUserId = isWhatsApp
    ? formatWhatsappPhoneForDisplay(row.line_user_id)
    : isKakao && typeof metadata.kakaoId === 'string'
      ? metadata.kakaoId
    : row.line_user_id
  const displayName = isWhatsApp
    ? presentWhatsappDisplayName(row.display_name, row.line_user_id)
    : row.display_name

  return {
    id: row.id,
    lineUserId,
    displayName,
    pictureUrl: row.picture_url,
    statusMessage: row.status_message,
    isFollowing: Boolean(row.is_following),
    metadata,
    refCode: (row as unknown as Record<string, unknown>).ref_code as string | null,
    slackChannelId: (row as unknown as Record<string, unknown>).slack_channel_id as string | null,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Convert a D1 snake_case Tag row to the shared camelCase shape */
function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  };
}

// GET /api/friends - list with pagination
friends.get('/api/friends', async (c) => {
  try {
    const limit = Number(c.req.query('limit') ?? '50');
    const offset = Number(c.req.query('offset') ?? '0');
    const tagId = c.req.query('tagId');
    const lineAccountId = c.req.query('lineAccountId');

    const db = c.env.DB;

    // Build WHERE conditions
    const conditions: string[] = [];
    const binds: unknown[] = [];
    if (tagId) {
      conditions.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      binds.push(tagId);
    }
    if (lineAccountId) {
      conditions.push('f.line_account_id = ?');
      binds.push(lineAccountId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countStmt = db.prepare(`SELECT COUNT(*) as count FROM friends f ${where}`);
    const totalRow = await (binds.length > 0 ? countStmt.bind(...binds) : countStmt).first<{ count: number }>();
    const total = totalRow?.count ?? 0;

    const listStmt = db.prepare(
      `SELECT f.*, la.channel_type
         FROM friends f
         LEFT JOIN line_accounts la ON la.id = f.line_account_id
         ${where}
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?`,
    );
    const listBinds = [...binds, limit, offset];
    const listResult = await listStmt.bind(...listBinds).all<FriendRowWithChannel>();
    const items = listResult.results;

    // Fetch tags for each friend in parallel so the list response includes tags
    const itemsWithTags = await Promise.all(
      items.map(async (friend) => {
        const tags = await getFriendTags(db, friend.id);
        return { ...serializeFriend(friend), tags: tags.map(serializeTag) };
      }),
    );

    return c.json({
      success: true,
      data: {
        items: itemsWithTags,
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
        hasNextPage: offset + limit < total,
      },
    });
  } catch (err) {
    console.error('GET /api/friends error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/count - friend count (must be before /:id)
friends.get('/api/friends/count', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let count: number;
    if (lineAccountId) {
      const row = await c.env.DB.prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?')
        .bind(lineAccountId).first<{ count: number }>();
      count = row?.count ?? 0;
    } else {
      count = await getFriendCount(c.env.DB);
    }
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('GET /api/friends/count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/ref-stats - ref code attribution stats
friends.get('/api/friends/ref-stats', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const where = lineAccountId ? 'WHERE line_account_id = ?' : 'WHERE ref_code IS NOT NULL';
    const binds = lineAccountId ? [lineAccountId] : [];
    const stmt = c.env.DB.prepare(
      `SELECT ref_code, COUNT(*) as count FROM friends ${where} AND ref_code IS NOT NULL GROUP BY ref_code ORDER BY count DESC`,
    );
    const result = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<{ ref_code: string; count: number }>();
    const total = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM friends ${lineAccountId ? 'WHERE line_account_id = ?' : ''} ${lineAccountId ? 'AND' : 'WHERE'} ref_code IS NOT NULL`,
    ).bind(...(lineAccountId ? [lineAccountId] : [])).first<{ count: number }>();
    return c.json({
      success: true,
      data: {
        routes: result.results.map((r) => ({ refCode: r.ref_code, friendCount: r.count })),
        totalWithRef: total?.count ?? 0,
      },
    });
  } catch (err) {
    console.error('GET /api/friends/ref-stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id - get single friend with tags
friends.get('/api/friends/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = c.env.DB;

    const [friend, tags] = await Promise.all([
      db
        .prepare(
          `SELECT f.*, la.channel_type
             FROM friends f
             LEFT JOIN line_accounts la ON la.id = f.line_account_id
            WHERE f.id = ?`,
        )
        .bind(id)
        .first<FriendRowWithChannel>(),
      getFriendTags(db, id),
    ]);

    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...serializeFriend(friend),
        tags: tags.map(serializeTag),
      },
    });
  } catch (err) {
    console.error('GET /api/friends/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friends/:id/tags - add tag
friends.post('/api/friends/:id/tags', async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ tagId: string }>();

    if (!body.tagId) {
      return c.json({ success: false, error: 'tagId is required' }, 400);
    }

    const db = c.env.DB;
    await addTagToFriend(db, friendId, body.tagId);

    // Enroll in tag_added scenarios that match this tag
    const allScenarios = await getScenarios(db);
    for (const scenario of allScenarios) {
      if (scenario.trigger_type === 'tag_added' && scenario.is_active && scenario.trigger_tag_id === body.tagId) {
        const existing = await db
          .prepare(`SELECT id FROM friend_scenarios WHERE friend_id = ? AND scenario_id = ?`)
          .bind(friendId, scenario.id)
          .first();
        if (!existing) {
          await enrollFriendInScenario(db, friendId, scenario.id);
        }
      }
    }

    // イベントバス発火: tag_change
    await fireEvent(db, 'tag_change', { friendId, eventData: { tagId: body.tagId, action: 'add' } });

    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    console.error('POST /api/friends/:id/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/friends/:id/tags/:tagId - remove tag
friends.delete('/api/friends/:id/tags/:tagId', async (c) => {
  try {
    const friendId = c.req.param('id');
    const tagId = c.req.param('tagId');

    await removeTagFromFriend(c.env.DB, friendId, tagId);

    // イベントバス発火: tag_change
    await fireEvent(c.env.DB, 'tag_change', { friendId, eventData: { tagId, action: 'remove' } });

    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friends/:id/tags/:tagId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/friends/:id/metadata - merge metadata fields
friends.put('/api/friends/:id/metadata', async (c) => {
  try {
    const friendId = c.req.param('id');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const body = await c.req.json<Record<string, unknown>>();
    const existing = JSON.parse(friend.metadata || '{}');
    const merged = { ...existing, ...body };
    const now = jstNow();

    await db
      .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
      .bind(JSON.stringify(merged), now, friendId)
      .run();

    const updated = await getFriendById(db, friendId);
    const tags = await getFriendTags(db, friendId);

    return c.json({
      success: true,
      data: {
        ...serializeFriend(updated!),
        tags: tags.map(serializeTag),
      },
    });
  } catch (err) {
    console.error('PUT /api/friends/:id/metadata error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/friends/:id/messages - get message history
friends.get('/api/friends/:id/messages', async (c) => {
  try {
    const friendId = c.req.param('id');
    const result = await c.env.DB
      .prepare(
        `SELECT id, direction, message_type as messageType, content, created_at as createdAt
         FROM messages_log WHERE friend_id = ? ORDER BY created_at ASC LIMIT 200`,
      )
      .bind(friendId)
      .all<{ id: string; direction: string; messageType: string; content: string; createdAt: string }>();
    return c.json({ success: true, data: result.results });
  } catch (err) {
    console.error('GET /api/friends/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

friends.get('/api/friends/:id/scheduled-messages', async (c) => {
  try {
    const friendId = c.req.param('id');
    const items = await listScheduledMessagesByFriend(c.env.DB, friendId);
    return c.json({
      success: true,
      data: items.map(serializeScheduledMessage),
    });
  } catch (err) {
    console.error('GET /api/friends/:id/scheduled-messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friends/:id/messages - send message to friend
friends.post('/api/friends/:id/messages', async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{
      messageType?: string;
      content: string;
      fileName?: string;
      fileSize?: string;
      fileIcon?: string;
      scheduledAt?: string | null;
    }>();

    if (!body.content) {
      return c.json({ success: false, error: 'content is required' }, 400);
    }

    const db = c.env.DB;
    const friend = await getMessagingFriendContext(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    const messageType = body.messageType ?? 'text';
    const content = messageType === 'text' ? replaceEmojiShortcodes(body.content) : body.content;
    const existingChat = await getChatByFriendId(db, friendId);

    if (body.scheduledAt) {
      const normalizedSchedule = normalizeFutureScheduledAt(body.scheduledAt);
      if (!normalizedSchedule.ok) {
        return c.json({ success: false, error: normalizedSchedule.error }, 400);
      }

      const scheduled = await createScheduledMessage(db, {
        friendId,
        chatId: existingChat?.id ?? null,
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

    // Log outgoing message
    const now = jstNow();
    const logId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
         VALUES (?, ?, 'outgoing', ?, ?, NULL, NULL, ?)`,
      )
      .bind(logId, friend.id, dispatchResult.messageType, dispatchResult.storedContent, now)
      .run();

    if (existingChat) {
      await updateChat(db, existingChat.id, {
        status: 'in_progress',
        lastMessageAt: now,
      });
    } else {
      const newChat = await createChat(db, { friendId: friend.id });
      await updateChat(db, newChat.id, {
        status: 'in_progress',
        lastMessageAt: now,
      });
    }

    return c.json({ success: true, data: { messageId: logId } });
  } catch (err) {
    console.error('POST /api/friends/:id/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/friends/:id/slack - link friend to Slack channel
friends.put('/api/friends/:id/slack', async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{ slackChannelId: string | null }>();

    await c.env.DB.prepare('UPDATE friends SET slack_channel_id = ?, updated_at = ? WHERE id = ?')
      .bind(body.slackChannelId, jstNow(), friendId)
      .run();

    return c.json({ success: true, data: { friendId, slackChannelId: body.slackChannelId } });
  } catch (err) {
    console.error('PUT /api/friends/:id/slack error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/friends/bulk-slack - bulk link friends to Slack channel
friends.post('/api/friends/bulk-slack', async (c) => {
  try {
    const body = await c.req.json<{ friendIds: string[]; slackChannelId: string }>();
    if (!body.friendIds?.length || !body.slackChannelId) {
      return c.json({ success: false, error: 'friendIds and slackChannelId are required' }, 400);
    }

    const now = jstNow();
    for (const friendId of body.friendIds) {
      await c.env.DB.prepare('UPDATE friends SET slack_channel_id = ?, updated_at = ? WHERE id = ?')
        .bind(body.slackChannelId, now, friendId)
        .run();
    }

    return c.json({ success: true, data: { updated: body.friendIds.length } });
  } catch (err) {
    console.error('POST /api/friends/bulk-slack error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { friends };
