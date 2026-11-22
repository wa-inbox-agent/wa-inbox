// Ecommerce preview-only: no WhatsApp or other outbound transport is imported.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
mkdirSync(path.join(process.cwd(),'data'),{recursive:true});
import {verifyWebhook,classifyEvent} from './ecommerce-core.js';
const db=new DatabaseSync(path.join(process.cwd(),'data','wa-inbox.db'));
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ecom_connections (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,provider TEXT NOT NULL,store_ref TEXT NOT NULL,label TEXT NOT NULL,
 created_at INTEGER NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,provider,store_ref));
CREATE TABLE IF NOT EXISTS ecom_events (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,connection_id TEXT NOT NULL,event_key TEXT NOT NULL,payload_hash TEXT NOT NULL,
 topic TEXT NOT NULL,kind TEXT,verification TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(tenant_id,connection_id,event_key),UNIQUE(tenant_id,connection_id,payload_hash,topic),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES ecom_connections(tenant_id,id));
CREATE TABLE IF NOT EXISTS ecom_records (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL,connection_id TEXT NOT NULL,source_ref TEXT NOT NULL,record_type TEXT NOT NULL,
 name TEXT,phone TEXT,amount TEXT,currency TEXT,recovery_url TEXT,status TEXT NOT NULL,consent INTEGER NOT NULL DEFAULT 0,
 link_ref TEXT,consent_note TEXT, opted_out INTEGER NOT NULL DEFAULT 0,synthetic INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,
 UNIQUE(tenant_id,connection_id,source_ref,record_type),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES ecom_connections(tenant_id,id));
CREATE TABLE IF NOT EXISTS ecom_workflows (
 tenant_id TEXT NOT NULL,connection_id TEXT NOT NULL,workflow TEXT NOT NULL,body TEXT NOT NULL,
 PRIMARY KEY(tenant_id,connection_id,workflow),FOREIGN KEY(tenant_id,connection_id) REFERENCES ecom_connections(tenant_id,id));`);
const providers=new Set(['salla','zid','shopify']);
const allowedTopics={salla:['abandoned.cart','abandoned.cart.updated','abandoned.cart.status.changed','order.created','order.status.updated','order.payment.updated'],zid:['abandoned_cart.created','abandoned_cart.completed','order.create','order.status.update','order.payment_status.update'],shopify:['carts/create','carts/update','checkouts/create','checkouts/update','orders/create','orders/paid','orders/fulfilled']};
const defaults={cart:'مرحبًا {{name}}، سلتك ما زالت بانتظارك. يمكنك إكمال طلبك من هنا: {{url}}',paid:'شكرًا {{name}}، تم تأكيد دفع طلبك رقم {{reference}}.',fulfilled:'مرحبًا {{name}}، تم تجهيز طلبك رقم {{reference}}. شكرًا لتسوقك معنا.'};
const clip=(v,n=200)=>String(v??'').slice(0,n);
const hash=v=>createHash('sha256').update(v).digest('hex');
const safePhone=v=>{const s=String(v??'').trim();return /^\+?[1-9][0-9 ()-]{7,23}$/.test(s)?s:null;};
const safeUrl=v=>{try{const u=new URL(String(v));return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}};
function bindings(){try{const b=JSON.parse(process.env.ECOM_WEBHOOK_BINDINGS||'{}');return b&&typeof b==='object'&&!Array.isArray(b)?b:{};}catch{return {};}}
function bound(c){const b=bindings()[c.id];if(!b||b.store_ref!==c.store_ref||b.provider!==c.provider)return null;return c.provider==='zid'?(b.username&&b.password?b:null):(b.secret?b:null);}
function connection(tenant,id){return db.prepare('SELECT * FROM ecom_connections WHERE tenant_id=? AND id=?').get(tenant,id);}
function list(tenant){return db.prepare('SELECT * FROM ecom_connections WHERE tenant_id=? ORDER BY created_at').all(tenant);}
function normalize(c,topic,p){
 const d=c.provider==='salla'?p.data:p;
 if(!d||typeof d!=='object')return null;
 // Zid's complete merchant fixture is not yet verified. Keep authenticated ledger entries only.
 if(c.provider==='zid')return null;
 const salla=c.provider==='salla';
 const isCart=topic.includes('cart')||topic.includes('checkout');
 const sourceRef=d.id??d.token;
 if(!['string','number'].includes(typeof sourceRef)||!String(sourceRef).trim())return null;
 const customer=d.customer??{};
 let status=isCart?'observed':'created';
 if(salla&&topic.startsWith('abandoned.cart'))status=topic==='abandoned.cart.status.changed'?(d.status==='purchased'?'converted':'observed'):'abandoned';
 if(!salla&&topic==='orders/paid')status='paid';
 if(!salla&&topic==='orders/fulfilled')status='fulfilled';
 // Salla status/payment schemas require a merchant fixture before paid/fulfilled claims.
 return {link_ref:!salla&&d.token?clip(d.token):null,source_ref:clip(sourceRef),record_type:isCart?'cart':'order',name:clip(customer.name??[customer.first_name,customer.last_name].filter(Boolean).join(' ')),phone:safePhone(customer.mobile??customer.phone??d.phone??d.shipping_address?.phone),amount:clip(salla?d.total?.amount:d.total_price,30),currency:clip(salla?d.total?.currency:d.currency,8),recovery_url:safeUrl(salla?d.checkout_url:d.abandoned_checkout_url),status};
}
function saveRecord(tenant,c,r,synthetic=false){
 if(!r)return;
 const old=db.prepare('SELECT * FROM ecom_records WHERE tenant_id=? AND connection_id=? AND source_ref=? AND record_type=?').get(tenant,c.id,r.source_ref,r.record_type);
 // Conversion is terminal. Sparse status notifications must not erase customer fields.
 const status=old?.status==='converted'?'converted':old?.status==='fulfilled'?'fulfilled':old?.status==='paid'&&r.status==='created'?'paid':r.status;
 if(old){db.prepare(`UPDATE ecom_records SET link_ref=COALESCE(?,link_ref),name=COALESCE(NULLIF(?,''),name),phone=COALESCE(?,phone),amount=COALESCE(NULLIF(?,''),amount),currency=COALESCE(NULLIF(?,''),currency),recovery_url=COALESCE(?,recovery_url),status=?,updated_at=? WHERE tenant_id=? AND id=?`).run(r.link_ref??null,r.name,r.phone,r.amount,r.currency,r.recovery_url,status,Date.now(),tenant,old.id);}
 else{db.prepare(`INSERT INTO ecom_records(id,tenant_id,connection_id,source_ref,record_type,name,phone,amount,currency,recovery_url,status,synthetic,updated_at,link_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),tenant,c.id,r.source_ref,r.record_type,r.name,r.phone,r.amount,r.currency,r.recovery_url,status,synthetic?1:0,Date.now(),r.link_ref??null);}
}
export function createEcommerce({tenantId,requireAdmin,app,express,isGlobalOptedOut=()=>false}){
 // Mount before express.json and before session middleware. Authentication precedes JSON parsing.
 app.post('/hooks/ecommerce/:connectionId/:topic',express.raw({type:'application/json',limit:'1mb'}),(req,res)=>{
  const tenant=tenantId();const c=connection(tenant,req.params.connectionId);
  if(!c)return res.sendStatus(404);
  const config=bound(c),topic=req.params.topic;
  if(!config)return res.status(503).json({error:'connector_not_configured'});
  if(!allowedTopics[c.provider].includes(topic))return res.status(400).json({error:'unsupported_topic'});
  if(!verifyWebhook({provider:c.provider,rawBody:req.body,headers:req.headers,credentials:config}))return res.sendStatus(401);
  if(c.provider==='shopify'&&(req.get('X-Shopify-Shop-Domain')!==c.store_ref||req.get('X-Shopify-Topic')!==topic))return res.sendStatus(403);
  let p;try{p=JSON.parse(req.body.toString('utf8'));}catch{return res.sendStatus(400);}
  if(!p||typeof p!=='object'||Array.isArray(p))return res.sendStatus(400);
  if(c.provider==='salla'&&(String(p.merchant)!==c.store_ref||p.event!==topic))return res.sendStatus(403);
  const payloadHash=hash(req.body),eventKey=clip(req.get('X-Shopify-Webhook-Id')||payloadHash,150);
  db.exec('BEGIN');
  try{
   const result=db.prepare(`INSERT OR IGNORE INTO ecom_events(id,tenant_id,connection_id,event_key,payload_hash,topic,kind,verification,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(randomUUID(),tenant,c.id,eventKey,payloadHash,topic,classifyEvent(c.provider,topic), 'verified',Date.now());
   if(result.changes){
    saveRecord(tenant,c,normalize(c,topic,p));
    if(c.provider==='shopify'&&topic.startsWith('orders/')){
     for(const ref of [p.cart_token,p.checkout_token,p.checkout_id].filter(v=>v!==undefined&&v!==null)){
      db.prepare("UPDATE ecom_records SET status='converted',updated_at=? WHERE tenant_id=? AND connection_id=? AND record_type='cart' AND (source_ref=? OR link_ref=?)").run(Date.now(),tenant,c.id,clip(ref),clip(ref));
     }
    }
   }
   db.exec('COMMIT');res.json({ok:true,duplicate:!result.changes,preview_only:true});
  }catch{db.exec('ROLLBACK');res.sendStatus(500);}
 });
 return function mountApi(){
  app.get('/api/ecommerce',requireAdmin,(req,res)=>{
   const tenant=tenantId();
   const connections=list(tenant).map(c=>({...c,configured:!!bound(c),merchant_tested:false,topics:allowedTopics[c.provider],webhook_path:`/hooks/ecommerce/${c.id}/`,verified_events:db.prepare("SELECT count(*) AS n FROM ecom_events WHERE tenant_id=? AND connection_id=? AND verification='verified'").get(tenant,c.id).n}));
   const records=db.prepare('SELECT * FROM ecom_records WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 300').all(tenant);
   const events=db.prepare('SELECT id,connection_id,topic,kind,verification,created_at FROM ecom_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 40').all(tenant);
   const workflows=db.prepare('SELECT connection_id,workflow,body FROM ecom_workflows WHERE tenant_id=?').all(tenant);
   res.json({preview_only:true,connections,records,events,workflows,defaults});
  });
  app.post('/api/ecommerce/connections',requireAdmin,(req,res)=>{
   const {provider}=req.body??{},label=clip(req.body?.label,80).trim(),storeRef=clip(req.body?.store_ref,150).trim().toLowerCase();
   if(!providers.has(provider)||!label||!storeRef)return res.status(400).json({error:'المنصة واسم المتجر ومعرّف المتجر مطلوبة'});
   if(provider==='shopify'&&!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(storeRef))return res.status(400).json({error:'أدخل نطاق المتجر بصيغة store.myshopify.com دون https'});
   if(provider==='salla'&&!/^\d{1,30}$/.test(storeRef))return res.status(400).json({error:'معرّف متجر سلة يجب أن يكون أرقامًا'});
   if(provider==='zid'&&!/^(?:\d{1,30}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(storeRef))return res.status(400).json({error:'أدخل معرّف متجر زد الرقمي أو UUID كما يظهر في إعدادات المتجر'});
   try{const id=randomUUID();db.prepare('INSERT INTO ecom_connections(id,tenant_id,provider,store_ref,label,created_at) VALUES(?,?,?,?,?,?)').run(id,tenantId(),provider,storeRef,label,Date.now());res.json({ok:true,id});}catch{res.status(409).json({error:'هذا المتجر مضاف بالفعل'});}
  });
  app.delete('/api/ecommerce/connections/:id',requireAdmin,(req,res)=>{
   const tenant=tenantId();if(!connection(tenant,req.params.id))return res.sendStatus(404);
   db.exec('BEGIN');try{
    for(const table of ['ecom_workflows','ecom_events','ecom_records'])db.prepare(`DELETE FROM ${table} WHERE tenant_id=? AND connection_id=?`).run(tenant,req.params.id);
    db.prepare('DELETE FROM ecom_connections WHERE tenant_id=? AND id=?').run(tenant,req.params.id);
    db.exec('COMMIT');res.json({ok:true,local_only:true});
   }catch{db.exec('ROLLBACK');res.sendStatus(500);}
  });
  app.post('/api/ecommerce/demo',requireAdmin,(req,res)=>{
   const tenant=tenantId();let c=list(tenant).find(x=>x.provider===req.body?.provider&&x.store_ref==='demo');
   if(!providers.has(req.body?.provider))return res.sendStatus(400);
   if(!c){c={id:randomUUID(),tenant_id:tenant,provider:req.body.provider,store_ref:'demo',label:`${req.body.provider} · بيانات تجريبية`};db.prepare('INSERT INTO ecom_connections(id,tenant_id,provider,store_ref,label,created_at) VALUES(?,?,?,?,?,?)').run(c.id,tenant,c.provider,c.store_ref,c.label,Date.now());}
   db.exec('BEGIN');try{
    for(const [ref,type,status]of [['DEMO-CART','cart','abandoned'],['DEMO-ORDER','order','paid'],['DEMO-RECOVERED','cart','converted']])saveRecord(tenant,c,{source_ref:ref,record_type:type,status,name:'عميل تجريبي',phone:null,amount:'149',currency:'SAR',recovery_url:null},true);
    db.exec('COMMIT');res.json({ok:true,synthetic:true});
   }catch{db.exec('ROLLBACK');res.sendStatus(500);}
  });
  app.post('/api/ecommerce/records/:id/consent',requireAdmin,(req,res)=>{
   const r=db.prepare('SELECT id FROM ecom_records WHERE tenant_id=? AND id=?').get(tenantId(),req.params.id);if(!r)return res.sendStatus(404);
   const note=clip(req.body?.note,500).trim(),consent=req.body?.consent===true,optedOut=req.body?.opted_out===true;
   if(consent&&!note)return res.status(400).json({error:'وثّق مصدر الموافقة وتاريخها أولًا'});
   db.prepare('UPDATE ecom_records SET consent=?,consent_note=?,opted_out=? WHERE tenant_id=? AND id=?').run(consent?1:0,note,optedOut?1:0,tenantId(),r.id);res.json({ok:true});
  });
  app.post('/api/ecommerce/workflows',requireAdmin,(req,res)=>{
   const {connection_id,workflow}=req.body??{},body=clip(req.body?.body,2000).trim();
   if(!connection(tenantId(),connection_id)||!Object.hasOwn(defaults,workflow)||!body)return res.sendStatus(400);
   db.prepare('INSERT INTO ecom_workflows(tenant_id,connection_id,workflow,body) VALUES(?,?,?,?) ON CONFLICT(tenant_id,connection_id,workflow) DO UPDATE SET body=excluded.body').run(tenantId(),connection_id,workflow,body);res.json({ok:true,preview_only:true});
  });
  app.get('/api/ecommerce/records/:id/preview',requireAdmin,(req,res)=>{
   const tenant=tenantId(),r=db.prepare('SELECT * FROM ecom_records WHERE tenant_id=? AND id=?').get(tenant,req.params.id);if(!r)return res.sendStatus(404);
   const workflow=r.record_type==='cart'?'cart':r.status==='fulfilled'?'fulfilled':'paid';
   const body=db.prepare('SELECT body FROM ecom_workflows WHERE tenant_id=? AND connection_id=? AND workflow=?').get(tenant,r.connection_id,workflow)?.body||defaults[workflow];
   const values={name:r.name||'عميلنا',url:r.recovery_url||'[رابط استعادة غير متاح]',reference:r.source_ref};
   const text=body.replace(/\{\{(name|url|reference)\}\}/g,(_,k)=>values[k]);
   const blocks=['المعاينة فقط: الإرسال الآلي غير موجود في هذا القسم'];
   if(r.synthetic)blocks.push('سجل تجريبي وليس عميلًا حقيقيًا');
   if(r.opted_out||(r.phone&&isGlobalOptedOut(r.phone)))blocks.push('العميل ألغى الاشتراك');
   if(!r.consent)blocks.push('موافقة واتساب غير موثقة');
   if(!r.phone)blocks.push('رقم العميل غير متاح');
   if(r.record_type==='cart'&&r.status!=='abandoned')blocks.push(r.status==='converted'?'أكمل العميل الشراء: المتابعة ملغاة':'لم يتم تأكيد ترك السلة');
   if(r.record_type==='cart'&&!r.recovery_url)blocks.push('رابط استعادة السلة غير متاح');
   if(r.record_type==='order'&&!['paid','fulfilled'].includes(r.status))blocks.push('الطلب غير مؤكد الدفع');
   blocks.push('يلزم التحقق من قالب ميتا أو نافذة المحادثة قبل أي إرسال مستقبلي');
   res.json({preview_only:true,text,blocks,workflow});
  });
 };
          }
