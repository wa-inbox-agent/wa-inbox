import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const str=(v,max=2000)=>String(v??'').trim().slice(0,max);
const fields=['kind','source_id','conversation_id','phone','name','direction','type','body','timestamp','opted_out','consent','consent_source','tags','agent','media_url'];
const truth=v=>['1','true','yes','نعم'].includes(String(v??'').trim().toLowerCase());
export function normalizeImport(rows,mapping,provider){
 if(!Array.isArray(rows)||!rows.length||rows.length>5000)throw Error('اختر من 1 إلى 5000 صف في الدفعة');
 if(!/^[a-zA-Z0-9_. -]{1,60}$/.test(provider))throw Error('اسم المصدر مطلوب: حروف لاتينية وأرقام فقط');
 const errors=[],valid=[],seen=new Map();
 for(const [i,row] of rows.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row)){errors.push({row:i+1,error:'الصف غير صالح'});continue;}
  let valueError='';const get=k=>{const source=mapping&&Object.hasOwn(mapping,k)?mapping[k]:k;const value=source?row[source]:'';if(value!=null&&(!['string','number','boolean'].includes(typeof value)||String(value).length>(k==='body'?16000:2000)))valueError='قيمة حقل غير صالحة أو أطول من الحد المسموح';return k==='body'||k==='consent'?String(value??''):str(value,2000);};
  const kind=get('kind')||'message';let phone=get('phone').replace(/[\s()+-]/g,'');
  if(phone.startsWith('00'))phone=phone.slice(2);
  const r={kind,source_id:get('source_id'),conversation_id:get('conversation_id'),phone,name:get('name'),direction:get('direction').toLowerCase(),type:get('type')||'text',body:get('body'),timestamp:get('timestamp'),opted_out:truth(get('opted_out')),consent:get('consent'),consent_source:get('consent_source'),tags:get('tags'),agent:get('agent'),media_url:get('media_url')};
  let error=valueError;
  if(error){}
  else if(!['message','contact'].includes(kind))error='kind يجب أن يكون message أو contact';
  else if(!/^[1-9][0-9]{7,14}$/.test(phone))error='رقم دولي غير صالح، أضف مفتاح الدولة';
  else if(kind==='message'&&!['inbound','outbound','system','internal'].includes(r.direction))error='اتجاه الرسالة غير صالح';
  else if(kind==='message'&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(r.timestamp))error='وقت الرسالة يجب أن يكون ISO مع المنطقة الزمنية';
  else if(r.timestamp&&!Number.isFinite(Date.parse(r.timestamp)))error='وقت غير صالح';
  else if(kind==='message'&&!r.body&&!r.media_url)error='نص الرسالة أو رابط الملف مطلوب';
  else if(r.media_url&&!/^https:\/\//i.test(r.media_url))error='رابط الملف يجب أن يبدأ بـ https';
  if(error){errors.push({row:i+1,error});continue;}
  if(r.timestamp){r.original_timestamp=r.timestamp;r.timestamp=new Date(r.timestamp).toISOString();}
  // Consent is source evidence only, never an active permission to send.
  r.consent_status='unverified';r.provider=provider;
  const hash=digest(r);const key=kind+':'+(r.source_id||hash);
  if(seen.has(key)){if(seen.get(key)!==hash)errors.push({row:i+1,error:'معرّف مصدر متكرر بمحتوى مختلف'});else valid.push({...r,key,hash,duplicate:true});}
  else {seen.set(key,hash);valid.push({...r,key,hash});}
 }
 return {valid,errors,fields};
}
export function createDataTransfer({app,requireAdmin,listPhoneNumbers,dbPath=path.join(process.cwd(),'data','wa-inbox.db')}){
 mkdirSync(path.dirname(dbPath),{recursive:true});const db=new DatabaseSync(dbPath);db.exec(`
 CREATE TABLE IF NOT EXISTS history_import_batches(id TEXT PRIMARY KEY,phone_number_id TEXT NOT NULL,agent_id INTEGER NOT NULL,provider TEXT NOT NULL,created_at INTEGER NOT NULL,committed_at INTEGER,payload TEXT NOT NULL,summary TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS history_import_records(id INTEGER PRIMARY KEY,phone_number_id TEXT NOT NULL,provider TEXT NOT NULL,source_key TEXT NOT NULL,content_hash TEXT NOT NULL,kind TEXT NOT NULL,phone TEXT NOT NULL,original_at TEXT,batch_id TEXT NOT NULL,payload TEXT NOT NULL,imported_at INTEGER NOT NULL,UNIQUE(phone_number_id,provider,source_key));
 CREATE INDEX IF NOT EXISTS history_import_dept ON history_import_records(phone_number_id,original_at);
 `);
 const admin=req=>req.agent?.role==='admin';
 function scope(req,res){const pn=str(req.query.pn||req.body?.phone_number_id,150);if(!pn||!listPhoneNumbers().some(p=>p.phone_number_id===pn)){res.status(400).json({error:'اختر قسمًا مسجلًا'});return null;}if(!admin(req)&&(!req.agent?.phone_number_id||req.agent.phone_number_id!==pn)){res.status(403).json({error:'لا تملك صلاحية هذا القسم'});return null;}return pn;}
 const safe=f=>(req,res)=>{try{return f(req,res);}catch(e){res.status(400).json({error:e.message});}};
 app.get('/api/data-transfer',requireAdmin,safe((req,res)=>{const pn=scope(req,res);if(!pn)return;const batches=db.prepare('SELECT id,provider,created_at,committed_at,summary FROM history_import_batches WHERE phone_number_id=? ORDER BY created_at DESC LIMIT 30').all(pn).map(x=>({...x,summary:JSON.parse(x.summary)}));const records=db.prepare('SELECT payload FROM history_import_records WHERE phone_number_id=? ORDER BY original_at DESC,id DESC LIMIT 100').all(pn).map(x=>JSON.parse(x.payload));res.json({batches,records,can_import:admin(req),fields,provider_format_verified:false,total:db.prepare('SELECT count(*) n FROM history_import_records WHERE phone_number_id=?').get(pn).n});}));
 app.post('/api/data-transfer/preview',requireAdmin,safe((req,res)=>{const pn=scope(req,res);if(!pn)return;const provider=str(req.body.provider,60);const out=normalizeImport(req.body.rows,req.body.mapping,provider);let duplicates=0,conflicts=0;const times=[];
 for(const r of out.valid){const prior=db.prepare('SELECT content_hash FROM history_import_records WHERE phone_number_id=? AND provider=? AND source_key=?').get(pn,provider,r.key);if(r.duplicate||prior?.content_hash===r.hash)duplicates++;else if(prior){conflicts++;out.errors.push({error:'معرّف محفوظ بمحتوى مختلف، لن يتم استبداله',source_id:r.source_id});}if(r.timestamp)times.push(r.timestamp);}
 times.sort();const summary={rows:req.body.rows.length,valid:out.valid.length,duplicates,conflicts,new:out.valid.length-duplicates-conflicts,errors:out.errors.length,from:times[0]||null,to:times.at(-1)||null,opted_out:out.valid.filter(x=>x.opted_out).length};const id=randomUUID();db.prepare('INSERT INTO history_import_batches VALUES(?,?,?,?,?,NULL,?,?)').run(id,pn,req.agent.id,provider,Date.now(),JSON.stringify(out.valid),JSON.stringify(summary));res.json({id,summary,errors:out.errors.slice(0,100),sample:out.valid.slice(0,15),historical_only:true,expires_minutes:30});}));
 app.post('/api/data-transfer/commit',requireAdmin,safe((req,res)=>{const pn=scope(req,res);if(!pn)return;const batch=db.prepare('SELECT * FROM history_import_batches WHERE id=? AND phone_number_id=? AND agent_id=?').get(str(req.body.batch_id,50),pn,req.agent.id);if(!batch)return res.status(404).json({error:'المعاينة غير موجودة'});if(batch.committed_at)return res.json({ok:true,already_committed:true});if(Date.now()-batch.created_at>1800000)throw Error('انتهت المعاينة، أعد التحقق');const summary=JSON.parse(batch.summary);if(summary.errors)throw Error('صحح أخطاء الملف أولًا');if(req.body.confirm_historical!==true)throw Error('تأكيد الاستيراد كسجل تاريخي فقط مطلوب');let inserted=0;db.exec('BEGIN IMMEDIATE');try{for(const r of JSON.parse(batch.payload)){const prior=db.prepare('SELECT content_hash FROM history_import_records WHERE phone_number_id=? AND provider=? AND source_key=?').get(pn,batch.provider,r.key);if(prior&&prior.content_hash!==r.hash)throw Error('تغيرت البيانات بعد المعاينة، أعد التحقق');if(!prior){inserted+=db.prepare('INSERT INTO history_import_records(phone_number_id,provider,source_key,content_hash,kind,phone,original_at,batch_id,payload,imported_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(pn,batch.provider,r.key,r.hash,r.kind,r.phone,r.timestamp||null,batch.id,JSON.stringify(r),Date.now()).changes;}}db.prepare('UPDATE history_import_batches SET committed_at=? WHERE id=?').run(Date.now(),batch.id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}res.json({ok:true,inserted,historical_only:true});}));
 app.get('/api/data-transfer/export',requireAdmin,safe((req,res)=>{const pn=scope(req,res);if(!pn)return;const archived=db.prepare('SELECT payload FROM history_import_records WHERE phone_number_id=? ORDER BY id').all(pn).map(x=>JSON.parse(x.payload));const live=db.prepare('SELECT m.wa_message_id source_id,m.wa_id phone,c.name,m.direction,m.type,m.body,m.media_id,m.created_at,m.sender agent FROM messages m LEFT JOIN conversations c ON c.wa_id=m.wa_id AND c.phone_number_id=m.phone_number_id WHERE m.phone_number_id=? ORDER BY m.id').all(pn).map(x=>({kind:'message',...x,timestamp:new Date(x.created_at).toISOString(),media_url:/^https:\/\//i.test(x.media_id||'')?x.media_id:'',provider:'platform',historical_only:false}));const contacts=db.prepare('SELECT ct.phone,ct.name,ct.opted_out,ct.created_at FROM contacts ct WHERE EXISTS(SELECT 1 FROM conversations cv WHERE cv.wa_id=ct.phone AND cv.phone_number_id=?)').all(pn).map(x=>({kind:'contact',...x,timestamp:new Date(x.created_at).toISOString(),provider:'platform'}));const rows=[...live,...contacts,...archived];const csv=req.query.format==='csv';res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition',`attachment; filename="department-history.${csv?'csv':'json'}"`);if(csv){const cell=v=>'"'+String(v??'').replace(/^[\s]*[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';res.type('text/csv; charset=utf-8').send('\uFEFF'+fields.join(',')+'\r\n'+rows.map(r=>fields.map(k=>cell(r[k])).join(',')).join('\r\n'));}else res.json({schema:'department-history-v1',phone_number_id:pn,exported_at:new Date().toISOString(),counts:{live_messages:live.length,contacts:contacts.length,imported:archived.length},notes:['No credentials or tokens included','Contact consent is not established by export','Media IDs are not downloaded files','Only contacts linked to this department are included'],rows});}));
 return {db};
}
