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
try { db.exec(`ALTER TABLE bot_rules ADD COLUMN phone_number_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN quoted_wa_id TEXT`); } catch {}
try { db.exec(`ALTER TABLE conversations ADD COLUMN labels TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE agents ADD COLUMN phone_number_id TEXT`); } catch {}

db.exec(`
CREATE TABLE IF NOT EXISTS csat_ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wa_id TEXT NOT NULL,
  phone_number_id TEXT,
  rating INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);`)

// ---------- تعدد الأرقام (قسم مستقل لكل رقم واتساب) ----------
try {
  db.exec(`
CREATE TABLE IF NOT EXISTS phone_numbers (
  phone_number_id TEXT PRIMARY KEY,
  label TEXT,
  display_number TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
)`);
} catch {}

const ENV_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID && !String(process.env.PHONE_NUMBER_ID).startsWith('SET_ME') ? String(process.env.PHONE_NUMBER_ID) : null;
if (ENV_PHONE_NUMBER_ID) {
  try {
    db.prepare(`INSERT INTO phone_numbers (phone_number_id, label, display_number, is_default, created_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(phone_number_id) DO NOTHING`)
      .run(ENV_PHONE_NUMBER_ID, 'أكاديمية غرفة جازان', null, Date.now());
  } catch {}
}
try {
  if (!db.prepare(`SELECT count(*) AS n FROM phone_numbers WHERE is_default = 1`).get().n) {
    db.exec(`UPDATE phone_numbers SET is_default = 1 WHERE phone_number_id = (SELECT phone_number_id FROM phone_numbers ORDER BY created_at ASC LIMIT 1)`);
  }
} catch {}

export function defaultPhoneNumberId() {
  return db.prepare(`SELECT phone_number_id FROM phone_numbers WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1`).get()?.phone_number_id ?? ENV_PHONE_NUMBER_ID ?? null;
}

// ترقية جدول المحادثات لمفتاح مركّب: نفس العميل تكون له محادثة مستقلة مع كل رقم
try {
  const convoCols = db.prepare(`PRAGMA table_info(conversations)`).all().map((c) => c.name);
  if (!convoCols.includes('phone_number_id')) {
    const defId = defaultPhoneNumberId() ?? '';
    db.exec(`BEGIN`);
    db.exec(`
CREATE TABLE conversations_new (
  wa_id TEXT NOT NULL,
  phone_number_id TEXT NOT NULL DEFAULT '',
  name TEXT,
  last_message TEXT,
  last_message_at INTEGER,
  unread INTEGER NOT NULL DEFAULT 0,
  bot_enabled INTEGER NOT NULL DEFAULT 1,
  assigned_to INTEGER,
  pending_menu INTEGER,
  last_after_hours_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  PRIMARY KEY (wa_id, phone_number_id)
)`);
    db.prepare(`
INSERT INTO conversations_new (wa_id, phone_number_id, name, last_message, last_message_at, unread, bot_enabled, assigned_to, pending_menu, last_after_hours_at, status)
SELECT wa_id, ?, name, last_message, last_message_at, unread, bot_enabled, assigned_to, pending_menu, last_after_hours_at, status FROM conversations`).run(defId);
    db.exec(`DROP TABLE conversations`);
    db.exec(`ALTER TABLE conversations_new RENAME TO conversations`);
    db.exec(`COMMIT`);
    console.log('تمت ترقية جدول المحادثات لدعم تعدد الأرقام');
  }
} catch (e) {
  try { db.exec(`ROLLBACK`); } catch {}
  console.error('فشلت ترقية جدول المحادثات:', e.message);
}
try { db.exec(`ALTER TABLE messages ADD COLUMN phone_number_id TEXT`); } catch {}
try {
  const defId = defaultPhoneNumberId();
  if (defId) db.prepare(`UPDATE messages SET phone_number_id = ? WHERE phone_number_id IS NULL`).run(defId);
} catch {}

export function listPhoneNumbers() {
  return db.prepare(`SELECT * FROM phone_numbers ORDER BY is_default DESC, created_at ASC`).all();
}

// تسجيل تلقائي لأي رقم تصله رسالة أول مرة (من بيانات الـ Webhook)
export function registerPhoneNumber(phoneNumberId, displayNumber = null) {
  if (!phoneNumberId) return;
  const id = String(phoneNumberId);
  const autoLabel = displayNumber ? `رقم ${displayNumber}` : `قسم ${id.slice(-4)}`;
  db.prepare(`INSERT INTO phone_numbers (phone_number_id, label, display_number, is_default, created_at)
    VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(phone_number_id) DO UPDATE SET display_number = COALESCE(excluded.display_number, phone_numbers.display_number)`)
    .run(id, autoLabel, displayNumber ?? null, Date.now());
}

export function setPhoneNumberLabel(phoneNumberId, label) {
  db.prepare(`UPDATE phone_numbers SET label = ? WHERE phone_number_id = ?`).run(label, String(phoneNumberId));
}

export function deletePhoneNumber(phoneNumberId) {
  const id = String(phoneNumberId);
  // يمسح الرقم المسجّل وكل بياناته المرتبطة (محادثات/رسائل/قواعد بوت) عشان ميبقاش له أثر في التقارير
  db.exec('BEGIN');
  try {
    db.prepare(`DELETE FROM messages WHERE phone_number_id = ?`).run(id);
    db.prepare(`DELETE FROM conversations WHERE phone_number_id = ?`).run(id);
    db.prepare(`DELETE FROM bot_rules WHERE phone_number_id = ?`).run(id);
    db.prepare(`DELETE FROM phone_numbers WHERE phone_number_id = ? AND is_default = 0`).run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

const now = () => Date.now();

// لقطة متسقة من قاعدة البيانات للنسخ الاحتياطي
export function snapshotTo(outPath) {
  db.exec(`VACUUM INTO '${outPath}'`);
}

export function upsertInbound({ waId, phoneNumberId = null, name, waMessageId, type, body, ts, mediaId = null, mimeType = null, filename = null, quotedWaId = null }) {
  const t = ts ?? now();
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, media_id, mime_type, filename, created_at, phone_number_id, quoted_wa_id)
     VALUES (?, ?, 'inbound', ?, ?, 'received', ?, ?, ?, ?, ?, ?)`
  ).run(waMessageId ?? null, waId, type, body ?? null, mediaId, mimeType, filename, t, pn, quotedWaId);

  db.prepare(
    `INSERT INTO conversations (wa_id, phone_number_id, name, last_message, last_message_at, unread)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT(wa_id, phone_number_id) DO UPDATE SET
       name = COALESCE(excluded.name, conversations.name),
       last_message = excluded.last_message,
       last_message_at = excluded.last_message_at,
       unread = conversations.unread + 1`
  ).run(waId, pn, name ?? null, body ?? `[${type}]`, t);
}

export function insertOutbound({ waId, phoneNumberId = null, waMessageId, body, bot = 0, type = 'text', mediaId = null, mimeType = null, sender = null, quotedWaId = null }) {
  const t = now();
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(
    `INSERT INTO messages (wa_message_id, wa_id, direction, type, body, status, bot, media_id, mime_type, sender, created_at, phone_number_id, quoted_wa_id)
     VALUES (?, ?, 'outbound', ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?)`
  ).run(waMessageId ?? null, waId, type, body, bot, mediaId, mimeType, sender, t, pn, quotedWaId);

  db.prepare(
    `INSERT INTO conversations (wa_id, phone_number_id, last_message, last_message_at, unread)
     VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(wa_id, phone_number_id) DO UPDATE SET
       last_message = excluded.last_message,
       last_message_at = excluded.last_message_at`
  ).run(waId, pn, body ?? `[${type}]`, t);
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
    if (agent.phone_number_id) {
      // موظف مربوط بقسم: يرى محادثات قسمه فقط
      return db
        .prepare(
          `SELECT c.*, a.name AS assigned_name, pn.label AS dept_label, pn.display_number AS dept_number FROM conversations c
           LEFT JOIN agents a ON a.id = c.assigned_to
           LEFT JOIN phone_numbers pn ON pn.phone_number_id = c.phone_number_id
           WHERE c.phone_number_id = ?
           ORDER BY c.last_message_at DESC`
        )
        .all(agent.phone_number_id);
    }
    return db
      .prepare(
        `SELECT c.*, a.name AS assigned_name, pn.label AS dept_label, pn.display_number AS dept_number FROM conversations c
         LEFT JOIN agents a ON a.id = c.assigned_to
         LEFT JOIN phone_numbers pn ON pn.phone_number_id = c.phone_number_id
         WHERE c.assigned_to IS NULL OR c.assigned_to = ?
         ORDER BY c.last_message_at DESC`
      )
      .all(agent.id);
  }
  return db
    .prepare(
      `SELECT c.*, a.name AS assigned_name, pn.label AS dept_label, pn.display_number AS dept_number FROM conversations c
       LEFT JOIN agents a ON a.id = c.assigned_to
       LEFT JOIN phone_numbers pn ON pn.phone_number_id = c.phone_number_id
       ORDER BY c.last_message_at DESC`
    )
    .all();
}

export function setConversationLabels(waId, labels, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET labels = ? WHERE wa_id = ? AND phone_number_id = ?`).run(String(labels ?? '').trim(), waId, pn);
}

// تحويل محادثة من قسم (رقم) لقسم آخر: المحادثة والرسايل بتتنقل للرقم الجديد
export function transferConversation(waId, fromPn, toPn) {
  const from = fromPn ?? defaultPhoneNumberId();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE messages SET phone_number_id = ? WHERE wa_id = ? AND phone_number_id = ?`).run(toPn, waId, from);
    const row = db.prepare(`SELECT * FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).get(waId, from);
    if (row) {
      db.prepare(`DELETE FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).run(waId, from);
      // لو فيه محادثة قديمة لنفس العميل تحت القسم المستهدف، امسحها عشان تتبدل
      db.prepare(`DELETE FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).run(waId, toPn);
      db.prepare(
        `INSERT INTO conversations (wa_id, phone_number_id, name, last_message, last_message_at, unread, bot_enabled, assigned_to, pending_menu, last_after_hours_at, status, labels)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(waId, toPn, row.name, row.last_message, row.last_message_at, 0, row.bot_enabled, null, null, row.last_after_hours_at, row.status, row.labels ?? '');
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function addCsatRating(waId, phoneNumberId, rating) {
  db.prepare(`INSERT INTO csat_ratings (wa_id, phone_number_id, rating, created_at) VALUES (?, ?, ?, ?)`).run(waId, phoneNumberId ?? null, rating, now());
}

export function csatStats() {
  const row = db.prepare(`SELECT COUNT(*) AS count, ROUND(AVG(rating), 1) AS avg FROM csat_ratings`).get();
  return { count: row.count ?? 0, avg: row.avg ?? null };
}

export function assignConversation(waId, agentId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET assigned_to = ? WHERE wa_id = ? AND phone_number_id = ?`).run(agentId, waId, pn);
}

// ---------- الموظفون ----------

export function createAgent({ username, name, passHash, role = 'agent', phoneNumberId = null }) {
  const r = db
    .prepare(`INSERT INTO agents (username, name, pass_hash, role, phone_number_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(username, name, passHash, role, phoneNumberId || null, now());
  return Number(r.lastInsertRowid);
}

export function setAgentDept(id, phoneNumberId = null) {
  db.prepare(`UPDATE agents SET phone_number_id = ? WHERE id = ?`).run(phoneNumberId || null, id);
}

export function listAgents() {
  return db.prepare(`SELECT id, username, name, role, active, created_at, phone_number_id FROM agents ORDER BY id ASC`).all();
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

export function listMessages(waId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET unread = 0 WHERE wa_id = ? AND phone_number_id = ?`).run(waId, pn);
  return db
    .prepare(
      `SELECT m.*, q.body AS quoted_body, q.type AS quoted_type, q.direction AS quoted_direction, q.sender AS quoted_sender
       FROM messages m
       LEFT JOIN messages q ON q.wa_message_id = m.quoted_wa_id AND q.wa_id = m.wa_id AND q.phone_number_id = m.phone_number_id
       WHERE m.wa_id = ? AND m.phone_number_id = ? ORDER BY m.created_at ASC`
    )
    .all(waId, pn);
}

// ---------- البوت ----------

export function getBotSettings() {
  return db.prepare(`SELECT enabled FROM bot_settings WHERE id = 1`).get() ?? { enabled: 1 };
}

export function setBotEnabled(enabled) {
  db.prepare(`UPDATE bot_settings SET enabled = ? WHERE id = 1`).run(enabled ? 1 : 0);
}

export function listBotRules() {
  return db.prepare(`SELECT b.*, pn.label AS dept_label FROM bot_rules b LEFT JOIN phone_numbers pn ON pn.phone_number_id = b.phone_number_id ORDER BY b.id ASC`).all();
}

export function addBotRule(keyword, response, type = 'keyword', options = null, phoneNumberId = null) {
  const r = db.prepare(`INSERT INTO bot_rules (keyword, response, type, options, phone_number_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    keyword.trim(),
    response.trim(),
    type,
    options ? JSON.stringify(options) : null,
    phoneNumberId || null,
    now()
  );
  return r.lastInsertRowid;
}

export function getBotRule(id) {
  const r = db.prepare(`SELECT * FROM bot_rules WHERE id = ?`).get(id);
  if (r?.options) r.options = JSON.parse(r.options);
  return r;
}

export function getPendingMenu(waId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  return db.prepare(`SELECT pending_menu FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).get(waId, pn)?.pending_menu ?? null;
}

export function setPendingMenu(waId, ruleId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET pending_menu = ? WHERE wa_id = ? AND phone_number_id = ?`).run(ruleId, waId, pn);
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

export function getLastAfterHours(waId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  return db.prepare(`SELECT last_after_hours_at FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).get(waId, pn)?.last_after_hours_at ?? 0;
}

export function setLastAfterHours(waId, ts, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET last_after_hours_at = ? WHERE wa_id = ? AND phone_number_id = ?`).run(ts, waId, pn);
}

export function deleteBotRule(id) {
  db.prepare(`DELETE FROM bot_rules WHERE id = ?`).run(id);
}

// إيجاد أول قاعدة تطابق نص الرسالة؛ قواعد القسم أولًا ثم العامة. * تطابق أي رسالة
export function matchBotRule(text, phoneNumberId = null) {
  const lower = String(text ?? '').toLowerCase();
  const rules = listBotRules();
  const scoped = rules.filter((r) => r.phone_number_id && r.phone_number_id === phoneNumberId);
  const global = rules.filter((r) => !r.phone_number_id);
  for (const rule of [...scoped, ...global]) {
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

export function getConversationBot(waId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  const row = db.prepare(`SELECT bot_enabled FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).get(waId, pn);
  return row ? row.bot_enabled : 1;
}

export function setConversationBot(waId, enabled, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET bot_enabled = ? WHERE wa_id = ? AND phone_number_id = ?`).run(enabled ? 1 : 0, waId, pn);
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

// ملخص الاستهلاك: اليوم وآخر 7 و30 يوم + توزيع على الأرقام
export function usageSummary() {
  const dayMs = 24 * 3600 * 1000;
  const nowT = now();
  const startOfDay = nowT - ((nowT + 3 * 3600 * 1000) % dayMs); // بتوقيت الرياض تقريبًا
  const range = (since) => {
    const r = db.prepare(
      `SELECT
        SUM(CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
        SUM(CASE WHEN direction = 'outbound' AND bot = 0 THEN 1 ELSE 0 END) AS outbound,
        SUM(CASE WHEN direction = 'outbound' AND bot = 1 THEN 1 ELSE 0 END) AS bot
       FROM messages WHERE created_at >= ?`
    ).get(since);
    return { inbound: r?.inbound ?? 0, outbound: r?.outbound ?? 0, bot: r?.bot ?? 0 };
  };
  const perNumber = db.prepare(
    `SELECT m.phone_number_id, pn.label,
      SUM(CASE WHEN m.direction = 'inbound' THEN 1 ELSE 0 END) AS inbound,
      SUM(CASE WHEN m.direction = 'outbound' THEN 1 ELSE 0 END) AS outbound
     FROM messages m LEFT JOIN phone_numbers pn ON pn.phone_number_id = m.phone_number_id
     GROUP BY m.phone_number_id ORDER BY inbound DESC`
  ).all();
  return {
    today: range(startOfDay),
    last7: range(nowT - 7 * dayMs),
    last30: range(nowT - 30 * dayMs),
    perNumber,
    conversations: db.prepare(`SELECT count(*) AS n FROM conversations`).get().n,
    openConversations: db.prepare(`SELECT count(*) AS n FROM conversations WHERE status = 'open'`).get().n,
    contacts: db.prepare(`SELECT count(*) AS n FROM contacts`).get().n,
    csat: csatStats(),
    optedOut: db.prepare(`SELECT count(*) AS n FROM contacts WHERE opted_out = 1`).get().n,
    campaignMessages: db.prepare(`SELECT count(*) AS n FROM campaign_recipients WHERE status IN ('sent','delivered','read')`).get().n,
  };
}

export function conversationExists(waId, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  return !!db.prepare(`SELECT 1 FROM conversations WHERE wa_id = ? AND phone_number_id = ?`).get(waId, pn);
}

export function resetFailedRecipients(campaignId) {
  const r = db.prepare(`UPDATE campaign_recipients SET status = 'pending', error = NULL WHERE campaign_id = ? AND status = 'failed'`).run(campaignId);
  return r.changes;
}

// ---------- حالة المحادثة (مفتوحة/مغلقة) ----------

export function setConversationStatus(waId, status, phoneNumberId = null) {
  const pn = phoneNumberId ?? defaultPhoneNumberId();
  db.prepare(`UPDATE conversations SET status = ? WHERE wa_id = ? AND phone_number_id = ?`).run(status, waId, pn);
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
