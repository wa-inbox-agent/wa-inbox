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
export async function sendText(to, body, phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const data = await graph(`${phoneNumberId || PHONE_NUMBER_ID}/messages`, {
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
export async function sendTemplate(to, templateName, languageCode = 'ar', phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const data = await graph(`${phoneNumberId || PHONE_NUMBER_ID}/messages`, {
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

// الملف التجاري للنشاط على واتساب (يظهر للعملاء في صفحة الحساب)
export async function getBusinessProfile(phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const data = await graph(`${phoneNumberId || PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`);
  return data?.data?.[0] ?? null;
}

export async function updateBusinessProfile(fields, phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  return graph(`${phoneNumberId || PHONE_NUMBER_ID}/whatsapp_business_profile`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', ...fields },
  });
}

// قائمة القوالب وحالاتها
export async function listTemplates() {
  requireCreds('WABA_ID', 'WHATSAPP_TOKEN');
  const data = await graph(
    `${WABA_ID}/message_templates?fields=name,status,category,language,components&limit=100`
  );
  return data?.data ?? [];
}

// إنشاء قالب جديد وتقديمه للمراجعة (هيدر/فوتر/أزرار/متغيرات)
export async function createTemplate({ name, category, language, body, headerType = 'NONE', headerText = '', footer = '', buttons = [], bodyExamples = [] }) {
  requireCreds('WABA_ID', 'WHATSAPP_TOKEN');
  const components = [];
  if (headerType && headerType !== 'NONE') {
    const header = { type: 'HEADER', format: headerType };
    if (headerType === 'TEXT') {
      header.text = headerText || 'عنوان';
      if (/\{\{\d+\}\}/.test(header.text)) header.example = { header_text: [header.text.replace(/\{\{\d+\}\}/g, 'مثال')] };
    }
    components.push(header);
  }
  const bodyComp = { type: 'BODY', text: body };
  const varCount = (body.match(/\{\{\d+\}\}/g) ?? []).length;
  if (varCount > 0) {
    bodyComp.example = { body_text: [bodyExamples.length ? bodyExamples.slice(0, varCount) : Array.from({ length: varCount }, (_, i) => `مثال ${i + 1}`)] };
  }
  components.push(bodyComp);
  if (footer?.trim()) components.push({ type: 'FOOTER', text: footer.trim() });
  const btns = (buttons ?? []).filter((b) => b?.text?.trim()).slice(0, 3);
  if (btns.length) {
    components.push({
      type: 'BUTTONS',
      buttons: btns.map((b) => {
        if (b.type === 'url') {
          const btn = { type: 'URL', text: b.text.trim(), url: String(b.url ?? '').trim() };
          if (/\{\{\d+\}\}/.test(btn.url)) btn.example = [btn.url.replace(/\{\{\d+\}\}/g, 'example')];
          return btn;
        }
        if (b.type === 'phone') return { type: 'PHONE_NUMBER', text: b.text.trim(), phone_number: String(b.phone ?? '').trim() };
        return { type: 'QUICK_REPLY', text: b.text.trim() };
      }),
    });
  }
  return graph(`${WABA_ID}/message_templates`, {
    method: 'POST',
    body: { name, category, language, components },
  });
}

// حذف قالب من حساب الواتساب
export async function deleteTemplate(name) {
  requireCreds('WABA_ID', 'WHATSAPP_TOKEN');
  return graph(`${WABA_ID}/message_templates?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// جلب رابط تحميل ميديا واردة من ميتا
export async function getMediaUrl(mediaId) {
  requireCreds('WHATSAPP_TOKEN');
  const data = await graph(`${mediaId}`);
  return data?.url;
}

// تحميل محتوى الميديا (الباينري)
export async function downloadMedia(url) {
  requireCreds('WHATSAPP_TOKEN');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`فشل تحميل الميديا: HTTP ${res.status}`);
  return { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') };
}

// إرسال ميديا برابط عام (داخل نافذة الـ 24 ساعة): image/document/audio/video
export async function sendMedia(to, type, link, caption = null, phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const media = { link };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) media.caption = caption;
  const data = await graph(`${phoneNumberId || PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', to, type, [type]: media },
  });
  return data;
}

// إرسال قالب مع هيدر ميديا اختياري (رابط صورة/مستند)
export async function sendTemplateEx(to, templateName, languageCode = 'ar', header = null, bodyParams = [], phoneNumberId = null) {
  requireCreds('PHONE_NUMBER_ID', 'WHATSAPP_TOKEN');
  const components = [];
  if (header?.link && header?.type) {
    const param = { type: header.type };
    param[header.type] = { link: header.link };
    components.push({ type: 'header', parameters: [param] });
  }
  if (Array.isArray(bodyParams) && bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: String(t) })) });
  }
  const template = { name: templateName, language: { code: languageCode } };
  if (components.length) template.components = components;
  const data = await graph(`${phoneNumberId || PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', to, type: 'template', template },
  });
  return data;
}
