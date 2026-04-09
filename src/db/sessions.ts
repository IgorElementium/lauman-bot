import { getDb } from './sqlite.js';
import { MessageParam } from '../llm/client.js';

export interface Session {
  id: number;
  chat_id: number;
  active_lead_id: number | null;
  active_lead_set_at: string | null;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export function getOrCreateSession(chatId: number): Session {
  const db = getDb();
  const now = new Date().toISOString();

  // Try to get existing session
  const existing = db
    .prepare('SELECT * FROM sessions WHERE chat_id = ?')
    .get(chatId) as Session | undefined;

  if (existing) {
    return existing;
  }

  // Create new session
  db.prepare(
    `INSERT INTO sessions (chat_id, active_lead_id, active_lead_set_at, last_message_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(chatId, null, null, null, now, now);

  return db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get(chatId) as Session;
}

export function updateSession(chatId: number, updates: Partial<Session>): void {
  const db = getDb();
  const now = new Date().toISOString();

  const setClauses = [];
  const values: unknown[] = [];

  if (updates.active_lead_id !== undefined) {
    setClauses.push('active_lead_id = ?');
    values.push(updates.active_lead_id);
  }

  if (updates.active_lead_set_at !== undefined) {
    setClauses.push('active_lead_set_at = ?');
    values.push(updates.active_lead_set_at);
  }

  if (updates.last_message_at !== undefined) {
    setClauses.push('last_message_at = ?');
    values.push(updates.last_message_at);
  }

  setClauses.push('updated_at = ?');
  values.push(now);
  values.push(chatId);

  const sql = `UPDATE sessions SET ${setClauses.join(', ')} WHERE chat_id = ?`;
  db.prepare(sql).run(...values);
}

export function getConversationHistory(
  chatId: number,
  limit: number = 30
): MessageParam[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM conversation_history
       WHERE chat_id = ?
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .all(chatId, limit) as Array<{
    message_type: 'user' | 'assistant' | 'tool_result';
    content: string;
  }>;

  return rows.map((row) => ({
    role: row.message_type === 'tool_result' ? 'user' : row.message_type,
    content: row.content,
  })) as MessageParam[];
}

export function addToConversationHistory(
  chatId: number,
  messageType: 'user' | 'assistant' | 'tool_result',
  content: string,
  metadata?: Record<string, unknown>
): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO conversation_history (chat_id, message_type, content, metadata, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    chatId,
    messageType,
    content,
    metadata ? JSON.stringify(metadata) : null,
    now
  );
}

export function clearConversationHistory(chatId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM conversation_history WHERE chat_id = ?').run(chatId);
}
