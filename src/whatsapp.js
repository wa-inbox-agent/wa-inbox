const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

// إرسال رسالة نصية عبر WhatsApp Cloud API
export async function sendText(to, body) {
  if (!PHONE_NUMBER_ID || !TOKEN) {
    throw new Error('PHONE_NUMBER_ID و WHATSAPP_TOKEN مطلوبان في ملف .env');
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: true, body },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`فشل الإرسال: ${msg}`);
    err.meta = data;
    throw err;
  }
  // data.messages[0].id هو wamid الخاص بالرسالة الصادرة
  return data;
}
