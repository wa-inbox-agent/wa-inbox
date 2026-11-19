// نقطة الإقلاع: استرجاع النسخة الاحتياطية أولًا، ثم تشغيل الخادم، ثم بدء دورة النسخ
import { restoreIfNeeded, startBackupLoop } from './backup.js';

await restoreIfNeeded();
await import('./server.js');
startBackupLoop();
