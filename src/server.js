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
  upsertContact,
  listContacts,
  setContactOptOut,
  deleteContact,
  isOptedOut,
  phonesForTag,
} from './db.js';
import { sendText, sendTemplate, listTemplates, createTemplate } from './whatsapp.js';

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

// رد البوت التلقائي على رسالة واردة (إن كان مفعّلًا)
async function maybeBotReply(msg) {
  if (msg.type !== 'text') return;
  if (!getBotSettings().enabled) return;
  if (!getConversationBot(msg.from)) return;
  const rule = matchBotRule(msg.text?.body);
  if (!rule) return;
  try {
    const result = await sendText(msg.from, rule.response);
    insertOutbound({ waId: msg.from, waMessageId: result?.messages?.[0]?.id, body: rule.response, bot: 1 });
  } catch (err) {
    console.error('فشل رد البوت:', err.message);
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
              upsertInbound({
                waId: msg.from,
                name: contact?.profile?.name ?? null,
                waMessageId: msg.id,
                type: msg.type,
                body: msg.text?.body ?? msg[msg.type]?.caption ?? null,
                ts: msg.timestamp ? Number(msg.timestamp) * 1000 : undefined,
              });
              upsertContact({ phone: msg.from, name: contact?.profile?.name ?? null });
              const inboundText = msg.text?.body?.trim() ?? '';
              if (msg.type === 'text' && /^(إيقاف|ايقاف|اوقف|stop|unsubscribe|إلغاء|الغاء)$/i.test(inboundText)) {
                setContactOptOut(msg.from, true);
              }
              await maybeBotReply(msg);
            }
          }
          for (const st of value?.statuses ?? []) {
            updateStatus(st.id, st.status);
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
  res.json({ conversations: listConversations() });
});

app.get('/api/conversations/:waId/messages', (req, res) => {
  res.json({ messages: listMessages(req.params.waId) });
});

app.post('/api/conversations/:waId/reply', wrap(async (req, res) => {
  const waId = req.params.waId;
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'نص الرسالة فارغ' });

  const result = await sendText(waId, body);
  insertOutbound({ waId, waMessageId: result?.messages?.[0]?.id, body });
  // تدخل بشري: نوقف البوت عن هذه المحادثة حتى يعاد تفعيله يدويًا
  setConversationBot(waId, false);
  res.json({ ok: true, result });
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
  const { keyword, response } = req.body ?? {};
  if (!keyword?.trim() || !response?.trim()) {
    return res.status(400).json({ error: 'الكلمة المفتاحية والرد مطلوبان' });
  }
  const id = addBotRule(keyword, response);
  res.json({ ok: true, id });
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
  const { name, template_name, language_code, numbers, tag, scheduled_at } = req.body ?? {};
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
  const id = createCampaign({ name: name.trim(), templateName: template_name, languageCode: language_code, numbers: cleaned, scheduledAt: sched });
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
        const result = await sendTemplate(r.wa_id, data.campaign.template_name, data.campaign.language_code);
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
