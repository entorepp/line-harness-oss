import { isTimeBefore, jstNow } from './utils.js';

export type ScheduledMessageStatus =
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface ScheduledMessageRow {
  id: string;
  friend_id: string;
  chat_id: string | null;
  message_type: string;
  content: string;
  metadata: string | null;
  scheduled_at: string;
  status: ScheduledMessageStatus;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduledMessageInput {
  friendId: string;
  chatId?: string | null;
  messageType: string;
  content: string;
  metadata?: string | null;
  scheduledAt: string;
}

export interface UpdateScheduledMessageStatusInput {
  sentAt?: string | null;
  lastError?: string | null;
}

export interface UpdateScheduledMessageInput {
  scheduledAt: string;
}

export async function createScheduledMessage(
  db: D1Database,
  input: CreateScheduledMessageInput,
): Promise<ScheduledMessageRow> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO scheduled_messages
         (id, friend_id, chat_id, message_type, content, metadata, scheduled_at, status, sent_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', NULL, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.friendId,
      input.chatId ?? null,
      input.messageType,
      input.content,
      input.metadata ?? null,
      input.scheduledAt,
      now,
      now,
    )
    .run();

  return (await getScheduledMessageById(db, id))!;
}

export async function getScheduledMessageById(
  db: D1Database,
  id: string,
): Promise<ScheduledMessageRow | null> {
  return db
    .prepare(`SELECT * FROM scheduled_messages WHERE id = ?`)
    .bind(id)
    .first<ScheduledMessageRow>();
}

export async function listScheduledMessagesByFriend(
  db: D1Database,
  friendId: string,
  limit = 20,
): Promise<ScheduledMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT *
         FROM scheduled_messages
        WHERE friend_id = ?
          AND status IN ('scheduled', 'sending', 'failed')
        ORDER BY scheduled_at ASC, created_at ASC
        LIMIT ?`,
    )
    .bind(friendId, limit)
    .all<ScheduledMessageRow>();

  return result.results;
}

export async function getDueScheduledMessages(
  db: D1Database,
  now: string,
  limit = 100,
): Promise<ScheduledMessageRow[]> {
  const result = await db
    .prepare(
      `SELECT *
         FROM scheduled_messages
        WHERE status = 'scheduled'
        ORDER BY scheduled_at ASC, created_at ASC
        LIMIT ?`,
    )
    .bind(limit)
    .all<ScheduledMessageRow>();

  return result.results.filter((row) => isTimeBefore(row.scheduled_at, now));
}

export async function updateScheduledMessageStatus(
  db: D1Database,
  id: string,
  status: ScheduledMessageStatus,
  updates: UpdateScheduledMessageStatusInput = {},
): Promise<void> {
  const now = jstNow();
  const fields: string[] = ['status = ?', 'updated_at = ?'];
  const values: unknown[] = [status, now];

  if (updates.sentAt !== undefined) {
    fields.push('sent_at = ?');
    values.push(updates.sentAt);
  } else if (status === 'sent') {
    fields.push('sent_at = ?');
    values.push(now);
  }

  if (updates.lastError !== undefined) {
    fields.push('last_error = ?');
    values.push(updates.lastError);
  } else if (status === 'sent' || status === 'scheduled' || status === 'sending') {
    fields.push('last_error = NULL');
  }

  values.push(id);

  await db
    .prepare(`UPDATE scheduled_messages SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function updateScheduledMessage(
  db: D1Database,
  id: string,
  updates: UpdateScheduledMessageInput,
): Promise<ScheduledMessageRow | null> {
  const now = jstNow();

  await db
    .prepare(
      `UPDATE scheduled_messages
          SET scheduled_at = ?,
              status = 'scheduled',
              sent_at = NULL,
              last_error = NULL,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(updates.scheduledAt, now, id)
    .run();

  return getScheduledMessageById(db, id);
}

export async function cancelScheduledMessage(
  db: D1Database,
  id: string,
): Promise<void> {
  await updateScheduledMessageStatus(db, id, 'cancelled', { lastError: null });
}
