import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const dataDir = path.join(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'wa-inbox.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  wa_id TEXT PRIMARY KEY,
  name TEXT,
  last_message TEXT,
  last_message_at INTEGER,
  unread INTEGER NOT NULL DEFAULT 0,
  bot_enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_message_id TEXT,
  wa_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  body TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_wa_id ON messages(wa_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_wamid ON messages(wa_message_id);

CREATE TABLE IF NOT EXISTS bot_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bot_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language_code TEXT NOT NULL DEFAULT 'ar',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY,
  name TEXT,
  tags TEXT NOT NULL DEFAULT '',
  opted_out INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  wa_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  wa_message_id TEXT,
  error TEXT,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_recipients_wamid ON campaign_recipients(wa_message_id);
`);

// ترقية قواعد قديمة لا تحتوي الأعمدة الجديدة
try { db.exec(`ALTER TABLE conversations ADD COLUMN bot_enabled INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN bot INTEGER NOT NULL DEFAULT 0`); } catch {}
try { db.exec(`INSERT OR IGNORE INTO bot_settings (id, enabled) VALUES (1, 1)`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN scheduled_at INTEGER`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN media_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN mime_type TEXT`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN filename TEXT`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN header_link TEXT`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN header_type TEXT`); } catch {}

const now = () => Date.now();

export function upsertInbound({ waId, name, waMessageId, type, body, ts, mediaId = null, mimeType = null, filename = null }) {
  const t = ts ?? now();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, media_id, mime_type, filename, created_at)
     VALUES (?, ?, 'inbound', ?, ?, 'received', ?, ?, ?, ?)`
  ).run(waMessageId ?? null, waId, type, body ?? null, mediaId, mimeType, filename, t);

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

export function insertOutbound({ waId, waMessageId, body, bot = 0, type = 'text', mediaId = null, mimeType = null }) {
  const t = now();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, bot, media_id, mime_type, created_at)
     VALUES (?, ?, 'outbound', ?, ?, 'sent', ?, ?, ?, ?)`
  ).run(waMessageId ?? null, waId, type, body, bot, mediaId, mimeType, t);

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
  // تحديث مستلمي الحملات المرتبطين بنفس الرسالة
  db.prepare(
    `UPDATE campaign_recipients SET status = ?, updated_at = ? WHERE wa_message_id = ?`
  ).run(status, now(), waMessageId);
}

export function listConversations() {
  return db.prepare(`SELECT * FROM conversations ORDER BY last_message_at DESC`).all();
}

export function getMessage(id) {
  return db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id);
}

export function listMessages(waId) {
  db.prepare(`UPDATE conversations SET unread = 0 WHERE wa_id = ?`).run(waId);
  return db.prepare(`SELECT * FROM messages WHERE wa_id = ? ORDER BY created_at ASC`).all(waId);
}

// ---------- البوت ----------

export function getBotSettings() {
  return db.prepare(`SELECT enabled FROM bot_settings WHERE id = 1`).get() ?? { enabled: 1 };
}

export function setBotEnabled(enabled) {
  db.prepare(`UPDATE bot_settings SET enabled = ? WHERE id = 1`).run(enabled ? 1 : 0);
}

export function listBotRules() {
  return db.prepare(`SELECT * FROM bot_rules ORDER BY id ASC`).all();
}

export function addBotRule(keyword, response) {
  const r = db.prepare(`INSERT INTO bot_rules (keyword, response, created_at) VALUES (?, ?, ?)`).run(
    keyword.trim(),
    response.trim(),
    now()
  );
  return r.lastInsertRowid;
}

export function deleteBotRule(id) {
  db.prepare(`DELETE FROM bot_rules WHERE id = ?`).run(id);
}

// إيجاد أول قاعدة تطابق نص الرسالة؛ القاعدة ذات الكلمة المفتاحية * تطابق أي رسالة
export function matchBotRule(text) {
  const lower = String(text ?? '').toLowerCase();
  for (const rule of listBotRules()) {
    if (rule.keyword === '*') return rule;
    if (lower.includes(rule.keyword.toLowerCase())) return rule;
  }
  return null;
}

export function getConversationBot(waId) {
  const row = db.prepare(`SELECT bot_enabled FROM conversations WHERE wa_id = ?`).get(waId);
  return row ? row.bot_enabled : 1;
}

export function setConversationBot(waId, enabled) {
  db.prepare(`UPDATE conversations SET bot_enabled = ? WHERE wa_id = ?`).run(enabled ? 1 : 0, waId);
}

// ---------- الحملات ----------

export function createCampaign({ name, templateName, languageCode, numbers, scheduledAt = null, headerLink = null, headerType = null }) {
  const t = now();
  const status = scheduledAt ? 'scheduled' : 'draft';
  const r = db
    .prepare(`INSERT INTO campaigns (name, template_name, language_code, status, scheduled_at, header_link, header_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, templateName, languageCode ?? 'ar', status, scheduledAt, headerLink, headerType, t);
  const id = Number(r.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO campaign_recipients (campaign_id, wa_id) VALUES (?, ?)`);
  for (const n of numbers) ins.run(id, n);
  return id;
}

export function listCampaigns() {
  return db
    .prepare(
      `SELECT c.*,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = c.id) AS total,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status IN ('sent','delivered','read')) AS sent,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'delivered') AS delivered,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'read') AS read,
        (SELECT count(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.status = 'failed') AS failed
       FROM campaigns c ORDER BY c.id DESC`
    )
    .all();
}

export function getCampaign(id) {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE id = ?`).get(id);
  if (!campaign) return null;
  const recipients = db
    .prepare(`SELECT * FROM campaign_recipients WHERE campaign_id = ? ORDER BY id ASC`)
    .all(id);
  return { campaign, recipients };
}

export function setCampaignStatus(id, status) {
  db.prepare(`UPDATE campaigns SET status = ? WHERE id = ?`).run(status, id);
}

export function pendingRecipients(id) {
  return db
    .prepare(`SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id ASC`)
    .all(id);
}

export function markRecipient(id, { status, waMessageId = null, error = null }) {
  db.prepare(
    `UPDATE campaign_recipients SET status = ?, wa_message_id = COALESCE(?, wa_message_id), error = ?, updated_at = ? WHERE id = ?`
  ).run(status, waMessageId, error, now(), id);
}

export function dueCampaigns() {
  return db
    .prepare(`SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`)
    .all(now());
}

// ---------- جهات الاتصال ----------

export function upsertContact({ phone, name = null, tags = null }) {
  db.prepare(
    `INSERT INTO contacts (phone, name, tags, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET
       name = COALESCE(excluded.name, contacts.name),
       tags = COALESCE(excluded.tags, contacts.tags)`
  ).run(phone, name, tags ?? '', now());
}

export function listContacts() {
  return db.prepare(`SELECT * FROM contacts ORDER BY created_at DESC`).all();
}

export function setContactOptOut(phone, optedOut) {
  db.prepare(`UPDATE contacts SET opted_out = ? WHERE phone = ?`).run(optedOut ? 1 : 0, phone);
}

export function deleteContact(phone) {
  db.prepare(`DELETE FROM contacts WHERE phone = ?`).run(phone);
}

export function isOptedOut(phone) {
  return Boolean(db.prepare(`SELECT opted_out FROM contacts WHERE phone = ?`).get(phone)?.opted_out);
}

// أرقام قسم معيّن (تاج) من المشتركين فقط
export function phonesForTag(tag) {
  const t = String(tag).trim().toLowerCase();
  return listContacts()
    .filter((c) => !c.opted_out && String(c.tags).toLowerCase().split(/\s+/).includes(t))
    .map((c) => c.phone);
}
