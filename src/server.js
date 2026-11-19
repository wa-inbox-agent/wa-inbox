import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertInbound,
  insertOutbound,
  updateStatus,
  listConversations,
  listMessages,
  getBotSettings,
  setBotEnabled,
  listBotRules,
  addBotRule,
  deleteBotRule,
  matchBotRule,
  getConversationBot,
  setConversationBot,
  createCampaign,
  listCampaigns,
  getCampaign,
  setCampaignStatus,
  pendingRecipients,
  markRecipient,
  dueCampaigns,
  getMessage,
  getBotRule,
  createApiKey,
  listApiKeys,
  deleteApiKey,
  touchApiKey,
  reportSummary,
  getPendingMenu,
  setPendingMenu,
  menuText,
  allSettings,
  getSetting,
  setSetting,
  getLastAfterHours,
  setLastAfterHours,
  assignConversation,
  createAgent,
  listAgents,
  getAgentByUsername,
  getAgent,
  setAgentActive,
  agentsCount,
  upsertContact,
  listContacts,
  setContactOptOut,
  deleteContact,
  isOptedOut,
  phonesForTag,
  conversationExists,
  setConversationStatus,
  updateContact,
  getContact,
  listCanned,
  addCanned,
  deleteCanned,
  listNotes,
  addNote,
  logWebhookEvent,
  recentWebhookEvents,
} from './db.js';
import { sendText, sendTemplate, sendTemplateEx, sendMedia, getMediaUrl, downloadMedia, listTemplates, createTemplate } from './whatsapp.js';
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { scryptSync, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const set = (v) => Boolean(v && !String(v).startsWith('SET_ME'));
const configured = () =>
  set(process.env.PHONE_NUMBER_ID) &&
  set(process.env.WABA_ID) &&
  set(process.env.WHATSAPP_TOKEN) &&
  set(VERIFY_TOKEN);

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: err.message, meta: err.meta ?? null });
  }
};

// ---------- المصادقة وتعدد الموظفين ----------

const AUTH_SECRET = process.env.AUTH_SECRET || randomBytes(32).toString('hex');
const COOKIE = 'wa_session';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = scryptSync(password, salt, 32);
    return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function signSession(agentId) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = `${agentId}.${exp}`;
  const sig = createHmac('sha256', AUTH_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function readSession(req) {
  const raw = req.headers.cookie?.split(/; */).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const parts = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  if (parts.length !== 3) return null;
  const [id, exp, sig] = parts;
  const expected = createHmac('sha256', AUTH_SECRET).update(`${id}.${exp}`).digest('hex');
  if (sig !== expected || Number(exp) < Date.now()) return null;
  const agent = getAgent(Number(id));
  return agent && agent.active ? agent : null;
}

// ملاحظة: داخل app.use('/api') يكون req.path بدون البادئة /api
const PUBLIC_API = new Set(['/health', '/auth/login']);
app.use('/api', (req, res, next) => {
  if (PUBLIC_API.has(req.path) || req.path.startsWith('/outbound')) return next();
  const agent = readSession(req);
  if (!agent) return res.status(401).json({ error: 'مطلوب تسجيل الدخول' });
  req.agent = agent;
  next();
});

function requireAdmin(req, res, next) {
  if (req.agent?.role !== 'admin') return res.status(403).json({ error: 'صلاحية المدير مطلوبة' });
  next();
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const agent = getAgentByUsername(String(username ?? '').trim());
  if (!agent || !agent.active || !verifyPassword(String(password ?? ''), agent.pass_hash)) {
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(signSession(agent.id))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`);
  res.json({ ok: true, agent: { id: agent.id, username: agent.username, name: agent.name, role: agent.role } });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ agent: req.agent });
});

app.get('/api/agents', requireAdmin, (req, res) => {
  res.json({ agents: listAgents() });
});

app.post('/api/agents', requireAdmin, (req, res) => {
  const { username, name, password, role } = req.body ?? {};
  if (!username?.trim() || !name?.trim() || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'اسم المستخدم والاسم وكلمة سر من 6 أحرف على الأقل مطلوبة' });
  }
  if (getAgentByUsername(username.trim())) return res.status(409).json({ error: 'اسم المستخدم مستخدم بالفعل' });
  const id = createAgent({ username: username.trim(), name: name.trim(), passHash: hashPassword(String(password)), role: role === 'admin' ? 'admin' : 'agent' });
  res.json({ ok: true, id });
});

app.post('/api/agents/:id/toggle', requireAdmin, (req, res) => {
  setAgentActive(Number(req.params.id), Boolean(req.body?.active));
  res.json({ ok: true });
});

// إسناد محادثة لموظف (أو فك الإسناد بـ null)
app.post('/api/conversations/:waId/assign', (req, res) => {
  const agentId = req.body?.agent_id ? Number(req.body.agent_id) : null;
  if (agentId && !getAgent(agentId)) return res.status(404).json({ error: 'الموظف غير موجود' });
  assignConversation(req.params.waId, agentId);
  res.json({ ok: true });
});

// إنشاء حساب المدير الأول من متغيرات البيئة عند أول تشغيل
if (agentsCount() === 0 && process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
  createAgent({
    username: process.env.ADMIN_USER,
    name: process.env.ADMIN_NAME || 'المدير',
    passHash: hashPassword(process.env.ADMIN_PASSWORD),
    role: 'admin',
  });
  console.log(`تم إنشاء حساب المدير: ${process.env.ADMIN_USER}`);
}

// هل نحن الآن خارج ساعات العمل؟ (بتوقيت الرياض)
function isAfterHours() {
  if (getSetting('after_hours_enabled') !== '1') return false;
  const nowRiyadh = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  const day = nowRiyadh.getUTCDay();
  const days = String(getSetting('work_days')).split(',').map((d) => Number(d.trim()));
  if (!days.includes(day)) return true;
  const hm = nowRiyadh.getUTCHours() * 60 + nowRiyadh.getUTCMinutes();
  const [sh, sm] = String(getSetting('work_start')).split(':').map(Number);
  const [eh, em] = String(getSetting('work_end')).split(':').map(Number);
  return hm < sh * 60 + sm || hm >= eh * 60 + em;
}

async function sendBotText(waId, body) {
  try {
    const result = await sendText(waId, body);
    insertOutbound({ waId, waMessageId: result?.messages?.[0]?.id, body, bot: 1 });
  } catch (err) {
    console.error('فشل رد البوت:', err.message);
  }
}

// رد البوت التلقائي على رسالة واردة (إن كان مفعّلًا)
async function maybeBotReply(msg) {
  if (msg.type !== 'text') return;
  if (!getBotSettings().enabled) return;
  if (!getConversationBot(msg.from)) return;
  const text = msg.text?.body ?? '';

  // خارج الدوام: رد واحد كل 12 ساعة لكل محادثة ويتجاوز باقي القواعد
  if (isAfterHours()) {
    if (Date.now() - getLastAfterHours(msg.from) > 12 * 3600 * 1000) {
      await sendBotText(msg.from, getSetting('after_hours_message'));
      setLastAfterHours(msg.from, Date.now());
    }
    return;
  }

  // قائمة معلّقة: رد برقم الخيار
  const pendingId = getPendingMenu(msg.from);
  if (pendingId) {
    setPendingMenu(msg.from, null);
    const rule = getBotRule(pendingId);
    const opt = (rule?.options ?? []).find((o) => o.key === text.trim());
    if (opt) {
      await sendBotText(msg.from, opt.reply);
      return;
    }
    // لم يختر رقمًا صحيحًا: نكمل للمطابقة العادية
  }

  const rule = matchBotRule(text);
  if (!rule) return;
  if (rule.type === 'menu') {
    await sendBotText(msg.from, menuText(rule));
    setPendingMenu(msg.from, rule.id);
  } else {
    await sendBotText(msg.from, rule.response);
  }
}

// ---------- Webhook ----------

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === VERIFY_TOKEN) {
    console.log('تم التحقق من الـ Webhook بنجاح');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhook', (req, res) => {
  res.sendStatus(200);

  (async () => {
    try {
      const entries = req.body?.entry ?? [];
      for (const entry of entries) {
        for (const change of entry.changes ?? []) {
          const value = change.value;
          if (value?.messages) {
            const contacts = value.contacts ?? [];
            for (const msg of value.messages) {
              const contact = contacts.find((c) => c.wa_id === msg.from);
              const isNewConversation = !conversationExists(msg.from);
              logWebhookEvent('message', `رسالة ${msg.type} من ${msg.from}`);
              const mediaObj = ['image', 'document', 'audio', 'video', 'sticker', 'voice'].includes(msg.type) ? msg[msg.type] : null;
              upsertInbound({
                waId: msg.from,
                name: contact?.profile?.name ?? null,
                waMessageId: msg.id,
                type: msg.type,
                body: msg.text?.body ?? msg[msg.type]?.caption ?? null,
                ts: msg.timestamp ? Number(msg.timestamp) * 1000 : undefined,
                mediaId: mediaObj?.id ?? null,
                mimeType: mediaObj?.mime_type ?? null,
                filename: mediaObj?.filename ?? null,
              });
              upsertContact({ phone: msg.from, name: contact?.profile?.name ?? null });
              const inboundText = msg.text?.body?.trim() ?? '';
              if (msg.type === 'text' && /^(إيقاف|ايقاف|اوقف|stop|unsubscribe|إلغاء|الغاء)$/i.test(inboundText)) {
                setContactOptOut(msg.from, true);
              }
              // رسالة ترحيب تلقائية لأول محادثة (عند تفعيلها من إعدادات البوت)
              if (isNewConversation && getSetting('welcome_enabled') === '1' && getBotSettings().enabled && getConversationBot(msg.from)) {
                await sendBotText(msg.from, getSetting('welcome_message'));
              }
              await maybeBotReply(msg);
            }
          }
          for (const st of value?.statuses ?? []) {
            updateStatus(st.id, st.status);
            logWebhookEvent('status', `حالة ${st.status} للرسالة ${st.id}`);
          }
        }
      }
    } catch (err) {
      console.error('خطأ أثناء معالجة الـ Webhook:', err);
    }
  })();
});

// ---------- صندوق الوارد ----------

app.get('/api/conversations', (req, res) => {
  res.json({ conversations: listConversations(req.agent) });
});

app.get('/api/conversations/:waId/messages', (req, res) => {
  res.json({ messages: listMessages(req.params.waId) });
});

app.post('/api/conversations/:waId/reply', wrap(async (req, res) => {
  const waId = req.params.waId;
  const body = String(req.body?.body ?? '').trim();
  const mediaUrl = String(req.body?.media_url ?? '').trim();
  const mediaType = String(req.body?.media_type ?? 'image');
  if (!body && !mediaUrl) return res.status(400).json({ error: 'نص الرسالة أو رابط الميديا مطلوب' });

  let result;
  if (mediaUrl) {
    if (!/^https:\/\//.test(mediaUrl)) return res.status(400).json({ error: 'رابط الميديا لازم يبدأ بـ https://' });
    result = await sendMedia(waId, mediaType, mediaUrl, body || null);
    insertOutbound({ waId, waMessageId: result?.messages?.[0]?.id, body: body || null, type: mediaType, mediaId: mediaUrl, sender: req.agent?.name ?? null });
  } else {
    result = await sendText(waId, body);
    insertOutbound({ waId, waMessageId: result?.messages?.[0]?.id, body, sender: req.agent?.name ?? null });
  }
  // تدخل بشري: نوقف البوت عن هذه المحادثة حتى يعاد تفعيله يدويًا
  setConversationBot(waId, false);
  res.json({ ok: true, result });
}));

// عرض/تحميل ميديا رسالة (صور ومستندات واردة أو روابط صادرة)
const mediaDir = path.join(process.cwd(), 'data', 'media');
mkdirSync(mediaDir, { recursive: true });
app.get('/api/media/:messageId', wrap(async (req, res) => {
  const msg = getMessage(Number(req.params.messageId));
  if (!msg || !msg.media_id) return res.status(404).json({ error: 'لا توجد ميديا لهذه الرسالة' });

  // رسالة صادرة برابط عام: نوجّه للرابط مباشرة
  if (msg.direction === 'outbound' && /^https:\/\//.test(msg.media_id)) return res.redirect(msg.media_id);

  const cachePath = path.join(mediaDir, String(msg.id));
  if (!existsSync(cachePath)) {
    const url = await getMediaUrl(msg.media_id);
    if (!url) return res.status(404).json({ error: 'رابط الميديا غير متاح' });
    const { buf, contentType } = await downloadMedia(url);
    writeFileSync(cachePath, buf);
    writeFileSync(cachePath + '.ct', contentType ?? 'application/octet-stream');
  }
  res.setHeader('Content-Type', existsSync(cachePath + '.ct') ? readFileSync(cachePath + '.ct', 'utf8') : 'application/octet-stream');
  if (msg.filename) res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(msg.filename)}`);
  createReadStream(cachePath).pipe(res);
}));

// تفعيل/إيقاف البوت لمحادثة واحدة
app.post('/api/conversations/:waId/bot', (req, res) => {
  setConversationBot(req.params.waId, Boolean(req.body?.enabled));
  res.json({ ok: true });
});

// ---------- القوالب ----------

app.get('/api/templates', wrap(async (req, res) => {
  res.json({ templates: await listTemplates() });
}));

app.post('/api/templates', wrap(async (req, res) => {
  const { name, category, language, body } = req.body ?? {};
  if (!name || !category || !language || !body) {
    return res.status(400).json({ error: 'الحقول المطلوبة: name, category, language, body' });
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    return res.status(400).json({ error: 'اسم القالب: حروف إنجليزية صغيرة وأرقام وشرطة سفلية فقط' });
  }
  res.json({ ok: true, result: await createTemplate({ name, category, language, body }) });
}));

// ---------- البوت ----------

app.get('/api/bot', (req, res) => {
  res.json({ enabled: Boolean(getBotSettings().enabled), rules: listBotRules() });
});

app.post('/api/bot/toggle', (req, res) => {
  setBotEnabled(Boolean(req.body?.enabled));
  res.json({ ok: true, enabled: Boolean(req.body?.enabled) });
});

app.post('/api/bot/rules', (req, res) => {
  const { keyword, response, type, options } = req.body ?? {};
  if (!keyword?.trim() || !response?.trim()) {
    return res.status(400).json({ error: 'الكلمة المفتاحية والرد مطلوبان' });
  }
  let opts = null;
  if (type === 'menu') {
    if (!Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'القائمة تحتاج خيارين على الأقل: رقم + عنوان + رد' });
    }
    opts = options.map((o, i) => ({ key: String(o.key ?? i + 1).trim(), label: String(o.label ?? '').trim(), reply: String(o.reply ?? '').trim() }));
    if (opts.some((o) => !o.key || !o.label || !o.reply)) {
      return res.status(400).json({ error: 'كل خيار يحتاج رقم وعنوان ورد' });
    }
  }
  const id = addBotRule(keyword, response, type === 'menu' ? 'menu' : 'keyword', opts);
  res.json({ ok: true, id });
});

// إعدادات الرد خارج الدوام وساعات العمل
app.get('/api/bot/after-hours', (req, res) => {
  const s = allSettings();
  res.json({
    enabled: s.after_hours_enabled === '1',
    message: s.after_hours_message,
    work_start: s.work_start,
    work_end: s.work_end,
    work_days: s.work_days,
  });
});

app.post('/api/bot/after-hours', (req, res) => {
  const { enabled, message, work_start, work_end, work_days } = req.body ?? {};
  if (enabled !== undefined) setSetting('after_hours_enabled', enabled ? '1' : '0');
  if (message !== undefined) setSetting('after_hours_message', message);
  if (work_start !== undefined) setSetting('work_start', work_start);
  if (work_end !== undefined) setSetting('work_end', work_end);
  if (work_days !== undefined) setSetting('work_days', work_days);
  res.json({ ok: true });
});

app.delete('/api/bot/rules/:id', (req, res) => {
  deleteBotRule(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- الحملات ----------

app.get('/api/campaigns', (req, res) => {
  res.json({ campaigns: listCampaigns() });
});

app.get('/api/campaigns/:id', (req, res) => {
  const data = getCampaign(Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'الحملة غير موجودة' });
  res.json(data);
});

app.post('/api/campaigns', (req, res) => {
  const { name, template_name, language_code, numbers, tag, scheduled_at, header_link, header_type } = req.body ?? {};
  let cleaned = [...new Set(
    String(numbers ?? '')
      .split(/[\s,;]+/)
      .map((n) => n.replace(/[^\d]/g, ''))
      .filter((n) => n.length >= 8)
  )];
  if (tag?.trim()) cleaned = [...new Set([...cleaned, ...phonesForTag(tag)])];
  cleaned = cleaned.filter((p) => !isOptedOut(p));
  if (!name?.trim() || !template_name || cleaned.length === 0) {
    return res.status(400).json({ error: 'اسم الحملة والقالب وقائمة الأرقام (أو قسم مشتركين) مطلوبة' });
  }
  const sched = scheduled_at ? Number(scheduled_at) : null;
  const id = createCampaign({ name: name.trim(), templateName: template_name, languageCode: language_code, numbers: cleaned, scheduledAt: sched, headerLink: header_link || null, headerType: header_link ? (header_type || 'image') : null });
  res.json({ ok: true, id, total: cleaned.length, scheduled: Boolean(sched) });
});

// بدء الإرسال: رسالة كل 1.1 ثانية تقريبًا احترامًا لحدود ميتا
const running = new Set();
async function runCampaign(id) {
  if (running.has(id)) return;
  const data = getCampaign(id);
  if (!data || data.campaign.status === 'done') return;
  running.add(id);
  setCampaignStatus(id, 'running');
  try {
    for (const r of pendingRecipients(id)) {
      if (isOptedOut(r.wa_id)) {
        markRecipient(r.id, { status: 'skipped', error: 'ألغى الاشتراك' });
        continue;
      }
      try {
        const header = data.campaign.header_link ? { link: data.campaign.header_link, type: data.campaign.header_type ?? 'image' } : null;
        const result = await sendTemplateEx(r.wa_id, data.campaign.template_name, data.campaign.language_code, header);
        markRecipient(r.id, { status: 'sent', waMessageId: result?.messages?.[0]?.id ?? null });
      } catch (err) {
        markRecipient(r.id, { status: 'failed', error: err.message });
      }
      await new Promise((s) => setTimeout(s, 1100));
    }
    setCampaignStatus(id, 'done');
  } finally {
    running.delete(id);
  }
}

app.post('/api/campaigns/:id/start', (req, res) => {
  const id = Number(req.params.id);
  const data = getCampaign(id);
  if (!data) return res.status(404).json({ error: 'الحملة غير موجودة' });
  if (data.campaign.status === 'done') return res.status(400).json({ error: 'الحملة مكتملة' });
  if (running.has(id)) return res.status(409).json({ error: 'الحملة تعمل بالفعل' });
  res.json({ ok: true });
  runCampaign(id);
});

// منفّذ الحملات المجدولة: فحص كل 20 ثانية
setInterval(() => {
  for (const c of dueCampaigns()) runCampaign(c.id);
}, 20000);

// ---------- جهات الاتصال ----------

app.get('/api/contacts', (req, res) => {
  res.json({ contacts: listContacts() });
});

app.post('/api/contacts/import', (req, res) => {
  const lines = String(req.body?.text ?? '').split(/\r?\n/);
  let count = 0;
  for (const line of lines) {
    const parts = line.split(/[,\t]/).map((p) => p.trim());
    const phone = (parts[0] ?? '').replace(/[^\d]/g, '');
    if (phone.length < 8) continue;
    upsertContact({ phone, name: parts[1] || null, tags: parts[2] || null });
    count++;
  }
  res.json({ ok: true, count });
});

app.post('/api/contacts/:phone/optout', (req, res) => {
  upsertContact({ phone: req.params.phone });
  setContactOptOut(req.params.phone, Boolean(req.body?.opted_out));
  res.json({ ok: true });
});

app.delete('/api/contacts/:phone', (req, res) => {
  deleteContact(req.params.phone);
  res.json({ ok: true });
});

// ---------- الـ API الخارجي (إشعارات أنظمة الغرفة) ----------

const hashKey = (k) => createHash('sha256').update(String(k)).digest('hex');

app.post('/api/outbound/send', wrap(async (req, res) => {
  const key = req.headers['x-api-key'];
  if (!key || !touchApiKey(hashKey(key))) return res.status(401).json({ error: 'مفتاح API غير صالح' });

  const { to, text, template_name, language_code, header_link, header_type } = req.body ?? {};
  const target = String(to ?? '').replace(/[^\d]/g, '');
  if (target.length < 8) return res.status(400).json({ error: 'رقم المستلم مطلوب بالصيغة الدولية' });

  let result;
  if (template_name) {
    const header = header_link ? { link: header_link, type: header_type ?? 'image' } : null;
    result = await sendTemplateEx(target, template_name, language_code ?? 'ar', header);
    insertOutbound({ waId: target, waMessageId: result?.messages?.[0]?.id, body: `[قالب: ${template_name}]`, type: 'template', sender: 'API' });
  } else if (text?.trim()) {
    result = await sendText(target, text.trim());
    insertOutbound({ waId: target, waMessageId: result?.messages?.[0]?.id, body: text.trim(), sender: 'API' });
  } else {
    return res.status(400).json({ error: 'أرسل text أو template_name' });
  }
  res.json({ ok: true, result });
}));

// إدارة المفاتيح (مدير فقط) — المفتاح يظهر مرة واحدة عند الإنشاء
app.get('/api/keys', requireAdmin, (req, res) => {
  res.json({ keys: listApiKeys() });
});

app.post('/api/keys', requireAdmin, (req, res) => {
  const label = String(req.body?.label ?? '').trim();
  if (!label) return res.status(400).json({ error: 'اسم المفتاح مطلوب' });
  const key = 'wk_' + randomBytes(18).toString('hex');
  const id = createApiKey(label, hashKey(key));
  res.json({ ok: true, id, key });
});

app.delete('/api/keys/:id', requireAdmin, (req, res) => {
  deleteApiKey(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- التقارير ----------

app.get('/api/reports/summary', (req, res) => {
  res.json(reportSummary());
});

// ---------- حالة المحادثة: مفتوحة / مغلقة ----------

app.post('/api/conversations/:waId/status', (req, res) => {
  const status = req.body?.status === 'closed' ? 'closed' : 'open';
  setConversationStatus(req.params.waId, status);
  res.json({ ok: true, status });
});

// ---------- بيانات جهة الاتصال وتعديلها ----------

app.get('/api/contacts/:phone', (req, res) => {
  const c = getContact(req.params.phone);
  if (!c) return res.status(404).json({ error: 'جهة الاتصال غير موجودة' });
  res.json(c);
});

app.post('/api/contacts/:phone', (req, res) => {
  upsertContact({ phone: req.params.phone });
  const { name, tags, notes } = req.body ?? {};
  updateContact(req.params.phone, {
    name: name !== undefined ? String(name) : undefined,
    tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).join(' ') : undefined,
    notes: notes !== undefined ? String(notes) : undefined,
  });
  res.json({ ok: true, contact: getContact(req.params.phone) });
});

// ---------- ملاحظات الفريق الداخلية (لا تُرسل للعميل) ----------

app.get('/api/conversations/:waId/notes', (req, res) => {
  res.json({ notes: listNotes(req.params.waId) });
});

app.post('/api/conversations/:waId/notes', (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'الملاحظة فارغة' });
  const id = addNote(req.params.waId, req.agent?.name ?? null, body);
  res.json({ ok: true, id });
});

// ---------- الردود الجاهزة ----------

app.get('/api/canned', (req, res) => {
  res.json({ canned: listCanned() });
});

app.post('/api/canned', (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title?.trim() || !body?.trim()) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
  const id = addCanned(title.trim(), body.trim());
  res.json({ ok: true, id });
});

app.delete('/api/canned/:id', (req, res) => {
  deleteCanned(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- رسالة الترحيب للمحادثات الجديدة ----------

app.get('/api/bot/welcome', (req, res) => {
  const s = allSettings();
  res.json({ enabled: s.welcome_enabled === '1', message: s.welcome_message });
});

app.post('/api/bot/welcome', (req, res) => {
  const { enabled, message } = req.body ?? {};
  if (enabled !== undefined) setSetting('welcome_enabled', enabled ? '1' : '0');
  if (message !== undefined) setSetting('welcome_message', String(message));
  res.json({ ok: true });
});

// ---------- حالة الـ Webhook وآخر الأحداث الواردة ----------

app.get('/api/webhook-events', (req, res) => {
  const events = recentWebhookEvents();
  const lastInbound = events.find((e) => e.kind === 'message') ?? null;
  res.json({
    configured: configured(),
    callback_url: '/webhook',
    last_inbound_at: lastInbound?.created_at ?? null,
    events,
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: configured() });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`الخادم يعمل على http://localhost:${PORT}`);
  if (!VERIFY_TOKEN || VERIFY_TOKEN === 'changeme-verify-token') {
    console.warn('تنبيه: غيّر VERIFY_TOKEN في ملف .env');
  }
});
