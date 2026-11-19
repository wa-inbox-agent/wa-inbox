const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

function requireCreds(...keys) {
  const env = { PHONE_NUMBER_ID, WABA_ID, WHATSAPP_TOKEN: TOKEN };
  const missing = keys.filter((k) => !env[k] || String(env[k]).startsWith('SET_ME'));
  if (missing.length) {
    throw new Error(`بيانات ميتا ناقصة: ${missing.join(', ')} — حدّثها من لوحة الاستضافة`);
  }
}

async function graph(pathname, { method = 'GET', body } = {}) {
  requireCreds('WHATSAPP_TOKEN');
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`خطأ من ميتا: ${msg}`);
    err.meta = data;
    throw err;
  }
  return data;
}

// إرسال رسالة نصية (داخل نافذة الـ 24 ساعة فقط)
export async function sendText(to, body) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const data = await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body },
    },
  });
  return data;
}

// إرسال قالب معتمد (للحملات وأول رسالة خارج النافذة)
export async function sendTemplate(to, templateName, languageCode = 'ar') {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const data = await graph(`${PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name: templateName, language: { code: languageCode } },
    },
  });
  return data;
}

// قائمة القوالب وحالاتها
export async function listTemplates() {
  requireCreds('WABA_ID', 'WHATSAPP_TOKEN');
  const data = await graph(
    `${WABA_ID}/message_templates?fields=name,status,category,language,components&limit=100`
  );
  return data?.data ?? [];
}

// إنشاء قالب جديد وتقديمه للمراجعة
export async function createTemplate({ name, category, language, body }) {
  requireCreds('WABA_ID', 'WHATSAPP_TOKEN');
  return graph(`${WABA_ID}/message_templates`, {
    method: 'POST',
    body: {
      name,
      category,
      language,
      components: [{ type: 'BODY', text: body }],
    },
  });
}
