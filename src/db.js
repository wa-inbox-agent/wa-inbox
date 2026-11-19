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

CREATE TABLE IF NOT EXISTS canned_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS convo_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  agent_name TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_wa ON convo_notes(wa_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  key_hash TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'agent',
  active INTEGER NOT NULL DEFAULT 1,
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
try { db.exec(`ALTER TABLE conversations ADD COLUMN assigned_to INTEGER`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender TEXT`); } catch {}
try { db.exec(`ALTER TABLE bot_rules ADD COLUMN type TEXT NOT NULL DEFAULT 'keyword'`); } catch {}
try { db.exec(`ALTER TABLE bot_rules ADD COLUMN options TEXT`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN pending_menu INTEGER`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN last_after_hours_at INTEGER`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN status TEXT NOT NULL DEFAULT 'open'`); } catch {}
try { db.exec(`ALTER TABLE contacts ADD COLUMN notes TEXT`); } catch {}
try { db.exec(`ALTER TABLE campaigns ADD COLUMN body_params TEXT`); } catch {}

const now = () => Date.now();

// لقطة متسقة من قاعدة البيانات للنسخ الاحتياطي
export function snapshotTo(outPath) {
  db.exec(`VACUUM INTO '${outPath}'`);
}

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

export function insertOutbound({ waId, waMessageId, body, bot = 0, type = 'text', mediaId = null, mimeType = null, sender = null }) {
  const t = now();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, bot, media_id, mime_type, sender, created_at)
     VALUES (?, ?, 'outbound', ?, ?, 'sent', ?, ?, ?, ?, ?)`
  ).run(waMessageId ?? null, waId, type, body, bot, mediaId, mimeType, sender, t);

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

export function listConversations(agent = null) {
  if (agent && agent.role !== 'admin') {
    return db
      .prepare(
        `SELECT c.*, a.name AS assigned_name FROM conversations c
         LEFT JOIN agents a ON a.id = c.assigned_to
         WHERE c.assigned_to IS NULL OR c.assigned_to = ?
         ORDER BY c.last_message_at DESC`
      )
      .all(agent.id);
  }
  return db
    .prepare(
      `SELECT c.*, a.name AS assigned_name FROM conversations c
       LEFT JOIN agents a ON a.id = c.assigned_to
       ORDER BY c.last_message_at DESC`
    )
    .all();
}

export function assignConversation(waId, agentId) {
  db.prepare(`UPDATE conversations SET assigned_to = ? WHERE wa_id = ?`).run(agentId, waId);
}

// ---------- الموظفون ----------

export function createAgent({ username, name, passHash, role = 'agent' }) {
  const r = db
    .prepare(`INSERT INTO agents (username, name, pass_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(username, name, passHash, role, now());
  return Number(r.lastInsertRowid);
}

export function listAgents() {
  return db.prepare(`SELECT id, username, name, role, active, created_at FROM agents ORDER BY id ASC`).all();
}

export function getAgentByUsername(username) {
  return db.prepare(`SELECT * FROM agents WHERE username = ?`).get(username);
}

export function getAgent(id) {
  return db.prepare(`SELECT id, username, name, role, active FROM agents WHERE id = ?`).get(id);
}

export function setAgentActive(id, active) {
  db.prepare(`UPDATE agents SET active = ? WHERE id = ?`).run(active ? 1 : 0, id);
}

export function agentsCount() {
  return db.prepare(`SELECT count(*) AS n FROM agents`).get().n;
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

export function addBotRule(keyword, response, type = 'keyword', options = null) {
  const r = db.prepare(`INSERT INTO bot_rules (keyword, response, type, options, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    keyword.trim(),
    response.trim(),
    type,
    options ? JSON.stringify(options) : null,
    now()
  );
  return r.lastInsertRowid;
}

export function getBotRule(id) {
  const r = db.prepare(`SELECT * FROM bot_rules WHERE id = ?`).get(id);
  if (r?.options) r.options = JSON.parse(r.options);
  return r;
}

export function getPendingMenu(waId) {
  return db.prepare(`SELECT pending_menu FROM conversations WHERE wa_id = ?`).get(waId)?.pending_menu ?? null;
}

export function setPendingMenu(waId, ruleId) {
  db.prepare(`UPDATE conversations SET pending_menu = ? WHERE wa_id = ?`).run(ruleId, waId);
}

// ---------- الإعدادات العامة (ساعات العمل، الرد خارج الدوام) ----------

const DEFAULTS = {
  welcome_enabled: '0',
  welcome_message: 'أهلًا بك في أكاديمية غرفة جازان! كيف نقدر نساعدك اليوم؟',
  after_hours_enabled: '0',
  after_hours_message: 'شكرًا لتواصلك معنا. نحن خارج أوقات العمل حاليًا، وسنرد عليك في أقرب وقت خلال الدوام.',
  work_start: '09:00',
  work_end: '17:00',
  work_days: '0,1,2,3,4',
};

export function getSetting(key) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row?.value ?? DEFAULTS[key] ?? null;
}

export function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, String(value));
}

export function allSettings() {
  const out = { ...DEFAULTS };
  for (const r of db.prepare(`SELECT key, value FROM settings`).all()) out[r.key] = r.value;
  return out;
}

export function getLastAfterHours(waId) {
  return db.prepare(`SELECT last_after_hours_at FROM conversations WHERE wa_id = ?`).get(waId)?.last_after_hours_at ?? 0;
}

export function setLastAfterHours(waId, ts) {
  db.prepare(`UPDATE conversations SET last_after_hours_at = ? WHERE wa_id = ?`).run(ts, waId);
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

// نص القائمة المرقّمة لقاعدة من نوع menu
export function menuText(rule) {
  const opts = typeof rule.options === 'string' ? JSON.parse(rule.options) : rule.options ?? [];
  const lines = opts.map((o) => `${o.key}) ${o.label}`);
  return [rule.response, ...lines].join('\n');
}

export function getConversationBot(waId) {
  const row = db.prepare(`SELECT bot_enabled FROM conversations WHERE wa_id = ?`).get(waId);
  return row ? row.bot_enabled : 1;
}

export function setConversationBot(waId, enabled) {
  db.prepare(`UPDATE conversations SET bot_enabled = ? WHERE wa_id = ?`).run(enabled ? 1 : 0, waId);
}

// ---------- الحملات ----------

export function createCampaign({ name, templateName, languageCode, numbers, scheduledAt = null, headerLink = null, headerType = null, bodyParams = [] }) {
  const t = now();
  const status = scheduledAt ? 'scheduled' : 'draft';
  const r = db
    .prepare(`INSERT INTO campaigns (name, template_name, language_code, status, scheduled_at, header_link, header_type, body_params, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, templateName, languageCode ?? 'ar', status, scheduledAt, headerLink, headerType, JSON.stringify(bodyParams ?? []), t);
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

// ---------- مفاتيح الـ API الخارجي ----------

export function createApiKey(label, keyHash) {
  const r = db.prepare(`INSERT INTO api_keys (label, key_hash, created_at) VALUES (?, ?, ?)`).run(label, keyHash, now());
  return Number(r.lastInsertRowid);
}

export function listApiKeys() {
  return db.prepare(`SELECT id, label, created_at, last_used_at FROM api_keys ORDER BY id DESC`).all();
}

export function deleteApiKey(id) {
  db.prepare(`DELETE FROM api_keys WHERE id = ?`).run(id);
}

export function touchApiKey(keyHash) {
  const r = db.prepare(`UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?`).run(now(), keyHash);
  return r.changes > 0;
}

// ---------- التقارير ----------

export function reportSummary() {
  const since = now() - 14 * 24 * 3600 * 1000;
  const perDay = db.prepare(
    `SELECT date(created_at / 1000, 'unixepoch') AS day,
       sum(direction = 'inbound') AS inbound,
       sum(direction = 'outbound') AS outbound
     FROM messages WHERE created_at >= ? GROUP BY day ORDER BY day DESC`
  ).all(since);
  const totals = db.prepare(
    `SELECT
       sum(direction = 'inbound') AS inbound,
       sum(direction = 'outbound') AS outbound,
       sum(bot = 1) AS bot_replies
     FROM messages`
  ).get();
  const campaigns = db.prepare(
    `SELECT count(*) AS total,
       sum(status = 'done') AS done,
       sum(status = 'running') AS running,
       sum(status = 'scheduled') AS scheduled
     FROM campaigns`
  ).get();
  const recipients = db.prepare(
    `SELECT
       sum(status IN ('sent','delivered','read')) AS sent,
       sum(status = 'delivered') AS delivered,
       sum(status = 'read') AS read,
       sum(status = 'failed') AS failed,
       sum(status = 'skipped') AS skipped
     FROM campaign_recipients`
  ).get();
  const contacts = db.prepare(`SELECT count(*) AS total, sum(opted_out = 1) AS opted_out FROM contacts`).get();
  const topConversations = db.prepare(
    `SELECT wa_id, count(*) AS messages FROM messages GROUP BY wa_id ORDER BY messages DESC LIMIT 5`
  ).all();
  return { perDay, totals, campaigns, recipients, contacts, topConversations };
}

export function conversationExists(waId) {
  return !!db.prepare(`SELECT 1 FROM conversations WHERE wa_id = ?`).get(waId);
}

export function resetFailedRecipients(campaignId) {
  const r = db.prepare(`UPDATE campaign_recipients SET status = 'pending', error = NULL WHERE campaign_id = ? AND status = 'failed'`).run(campaignId);
  return r.changes;
}

// ---------- حالة المحادثة (مفتوحة/مغلقة) ----------

export function setConversationStatus(waId, status) {
  db.prepare(`UPDATE conversations SET status = ? WHERE wa_id = ?`).run(status, waId);
}

// ---------- تعديل جهة اتصال ----------

export function updateContact(phone, { name, tags, notes }) {
  if (name !== undefined) db.prepare(`UPDATE contacts SET name = ? WHERE phone = ?`).run(name, phone);
  if (tags !== undefined) db.prepare(`UPDATE contacts SET tags = ? WHERE phone = ?`).run(tags, phone);
  if (notes !== undefined) db.prepare(`UPDATE contacts SET notes = ? WHERE phone = ?`).run(notes, phone);
}

export function getContact(phone) {
  return db.prepare(`SELECT * FROM contacts WHERE phone = ?`).get(phone);
}

// ---------- الردود الجاهزة ----------

export function listCanned() {
  return db.prepare(`SELECT * FROM canned_responses ORDER BY id ASC`).all();
}

export function addCanned(title, body) {
  const r = db.prepare(`INSERT INTO canned_responses (title, body, created_at) VALUES (?, ?, ?)`).run(title, body, now());
  return Number(r.lastInsertRowid);
}

export function deleteCanned(id) {
  db.prepare(`DELETE FROM canned_responses WHERE id = ?`).run(id);
}

// ---------- ملاحظات الفريق الداخلية على المحادثات ----------

export function listNotes(waId) {
  return db.prepare(`SELECT * FROM convo_notes WHERE wa_id = ? ORDER BY created_at ASC`).all(waId);
}

export function addNote(waId, agentName, body) {
  const r = db.prepare(`INSERT INTO convo_notes (wa_id, agent_name, body, created_at) VALUES (?, ?, ?, ?)`).run(waId, agentName, body, now());
  return Number(r.lastInsertRowid);
}

// ---------- سجل أحداث الـ Webhook ----------

export function logWebhookEvent(kind, summary) {
  db.prepare(`INSERT INTO webhook_events (kind, summary, created_at) VALUES (?, ?, ?)`).run(kind, summary, now());
  db.prepare(`DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY id DESC LIMIT 50)`).run();
}

export function recentWebhookEvents() {
  return db.prepare(`SELECT * FROM webhook_events ORDER BY id DESC LIMIT 10`).all();
}
