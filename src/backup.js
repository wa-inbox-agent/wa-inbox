import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const REPO = process.env.BACKUP_REPO; // مثل owner/repo
const TOKEN = process.env.BACKUP_TOKEN;
const dataDir = path.join(process.cwd(), 'data');
const DB_PATH = path.join(dataDir, 'wa-inbox.db');
const SNAP_PATH = path.join(dataDir, 'snapshot.db');
const REMOTE_PATH = 'wa-inbox.db';

export const backupEnabled = Boolean(REPO && TOKEN && !String(TOKEN).startsWith('SET_ME'));

let lastHash = null;

async function gh(method, p, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${REMOTE_PATH}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'wa-inbox-backup',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub backup: HTTP ${res.status} ${data?.message ?? ''}`);
  return data;
}

// استرجاع قاعدة البيانات عند الإقلاع لو الملف المحلي مش موجود (بعد redeploy مثلًا)
export async function restoreIfNeeded() {
  if (!backupEnabled) return;
  if (existsSync(DB_PATH)) return;
  try {
    const data = await gh('GET');
    if (!data?.content) {
      console.log('النسخ الاحتياطي: لا توجد نسخة سابقة — بداية جديدة');
      return;
    }
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(DB_PATH, Buffer.from(data.content.replace(/\n/g, ''), 'base64'));
    console.log('تم استرجاع قاعدة البيانات من النسخة الاحتياطية ✅');
  } catch (err) {
    console.error('فشل استرجاع النسخة الاحتياطية:', err.message);
  }
}

export async function backupNow(force = false) {
  if (!backupEnabled || !existsSync(DB_PATH)) return;
  const { snapshotTo } = await import('./db.js');
  snapshotTo(SNAP_PATH);
  const buf = readFileSync(SNAP_PATH);
  rmSync(SNAP_PATH, { force: true });
  const hash = createHash('sha256').update(buf).digest('hex');
  if (!force && hash === lastHash) return;
  const existing = await gh('GET');
  await gh('PUT', undefined, {
    message: `backup ${new Date().toISOString()}`,
    content: buf.toString('base64'),
    ...(existing?.sha ? { sha: existing.sha } : {}),
  });
  lastHash = hash;
  console.log('تم رفع نسخة احتياطية من قاعدة البيانات ✅');
}

export function startBackupLoop() {
  if (!backupEnabled) {
    console.log('النسخ الاحتياطي غير مفعّل (BACKUP_REPO/BACKUP_TOKEN غير مضبوطين)');
    return;
  }
  // نسخة أولى بعد الإقلاع مباشرة، ثم كل 5 دقائق عند تغيّر البيانات
  backupNow(true).catch((e) => console.error('فشل النسخ الاحتياطي:', e.message));
  const t = setInterval(() => backupNow().catch((e) => console.error('فشل النسخ الاحتياطي:', e.message)), 5 * 60 * 1000);
  t.unref();
  process.on('SIGTERM', async () => {
    try { await backupNow(true); } catch {}
    process.exit(0);
  });
}
