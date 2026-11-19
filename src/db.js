import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'wa-inbox.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  wa_id TEXT PRIMARY KEY,          -- رقم العميل بصيغة دولية بدون +
  name TEXT,                       -- اسم العميل من بروفايل واتساب
  last_message TEXT,
  last_message_at INTEGER,         -- milliseconds
  unread INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT,              -- معرّف الرسالة عند واتساب (wamid)
  wa_id TEXT NOT NULL,             -- رقم العميل
  direction TEXT NOT NULL,         -- inbound | outbound
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  status TEXT NOT NULL DEFAULT 'received', -- received | sent | delivered | read | failed
  created_at INTEGER NOT NULL      -- milliseconds
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wa_message_id);
`);

const now = () => Date.now();

export function upsertInbound({ waId, name, waMessageId, type, body, ts }) {
  const t = ts ?? now();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, created_at)
     VALUES (?, ?, 'inbound', ?, ?, 'received', ?)`
  ).run(waMessageId ?? null, waId, type, body ?? null, t);

  db.prepare(
    `INSERT INTO conversations (wa_id, name, last_message, last_message_at, unread)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(wa_id) DO UPDATE SET
       name = COALESCE(excluded.name, conversations.name),
       last_message = excluded.last_message,
       last_message_at = excluded.last_message_at,
       unread = conversations.unread + 1`
  ).run(waId, name ?? null, body ?? `[${type}]`, t);
}

export function insertOutbound({ waId, waMessageId, body }) {
  const t = now();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, created_at)
     VALUES (?, ?, 'outbound', 'text', ?, 'sent', ?)`
  ).run(waMessageId ?? null, waId, body, t);

  db.prepare(
    `INSERT INTO conversations (wa_id, last_message, last_message_at, unread)
     VALUES (?, ?, ?, 0)
     ON CONFLICT(wa_id) DO UPDATE SET
       last_message = excluded.last_message,
       last_message_at = excluded.last_message_at`
  ).run(waId, body, t);
}

export function updateStatus(waMessageId, status) {
  db.prepare(`UPDATE messages SET status = ? WHERE wa_message_id = ?`).run(status, waMessageId);
}

export function listConversations() {
  return db
    .prepare(`SELECT * FROM conversations ORDER BY last_message_at DESC`)
    .all();
}

export function listMessages(waId) {
  db.prepare(`UPDATE conversations SET unread = 0 WHERE wa_id = ?`).run(waId);
  return db
    .prepare(`SELECT * FROM messages WHERE wa_id = ? ORDER BY created_at ASC`)
    .all(waId);
}
