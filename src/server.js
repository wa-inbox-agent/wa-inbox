import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertInbound,
  insertOutbound,
  updateStatus,
  listConversations,
  listMessages,
} from './db.js';
import { sendText } from './whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// ---------- Webhook ----------

// التحقق من الـ Webhook (ميتا تناديه مرة واحدة عند الربط)
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

// استقبال الرسائل والتحديثات
app.post('/webhook', (req, res) => {
  // نرد 200 فورًا كما تتطلب ميتا، ثم نعالج
  res.sendStatus(200);

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
          }
        }
        // تحديثات حالة الرسائل الصادرة (sent/delivered/read/failed)
        for (const st of value?.statuses ?? []) {
          updateStatus(st.id, st.status);
        }
      }
    }
  } catch (err) {
    console.error('خطأ أثناء معالجة الـ Webhook:', err);
  }
});

// ---------- API صندوق الوارد ----------

app.get('/api/conversations', (req, res) => {
  res.json({ conversations: listConversations() });
});

app.get('/api/conversations/:waId/messages', (req, res) => {
  res.json({ messages: listMessages(req.params.waId) });
});

app.post('/api/conversations/:waId/reply', async (req, res) => {
  const waId = req.params.waId;
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'نص الرسالة فارغ' });

  try {
    const result = await sendText(waId, body);
    insertOutbound({ waId, waMessageId: result?.messages?.[0]?.id, body });
    res.json({ ok: true, result });
  } catch (err) {
    console.error(err.message);
    res.status(502).json({ error: err.message, meta: err.meta ?? null });
  }
});

app.get('/api/health', (req, res) => {
  const set = (v) => Boolean(v && !v.startsWith('SET_ME'));
  res.json({
    ok: true,
    configured:
      set(process.env.PHONE_NUMBER_ID) &&
      set(process.env.WABA_ID) &&
      set(process.env.WHATSAPP_TOKEN) &&
      set(VERIFY_TOKEN),
  });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`الخادم يعمل على http://localhost:${PORT}`);
  if (!VERIFY_TOKEN || VERIFY_TOKEN === 'changeme-verify-token') {
    console.warn('تنبيه: غيّر VERIFY_TOKEN في ملف .env');
  }
});
