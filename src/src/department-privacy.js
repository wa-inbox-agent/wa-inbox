import {createHash, randomBytes} from 'node:crypto';
import * as s from './db.js';

// Fail-closed boundary for every employee API. Global originals stay admin-only.
export function createDepartmentPrivacy({app}) {
  const db=s.db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS department_contacts (
      phone_number_id TEXT NOT NULL, phone TEXT NOT NULL, name TEXT, tags TEXT NOT NULL DEFAULT '',
      opted_out INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(phone_number_id,phone));
    CREATE TABLE IF NOT EXISTS department_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone_number_id TEXT NOT NULL, wa_id TEXT NOT NULL,
      agent_name TEXT, body TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS department_canned (
      id INTEGER PRIMARY KEY AUTOINCREMENT, phone_number_id TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS department_templates (
      phone_number_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(phone_number_id,name));
    CREATE TABLE IF NOT EXISTS department_media (
      phone_number_id TEXT NOT NULL, media_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(phone_number_id,media_id));
    CREATE TABLE IF NOT EXISTS api_key_departments (key_id INTEGER PRIMARY KEY, phone_number_id TEXT NOT NULL);
  `);
  const get=(q,...p)=>db.prepare(q).get(...p);
  const all=(q,...p)=>db.prepare(q).all(...p);
  const run=(q,...p)=>db.prepare(q).run(...p);
  const exists=pn=>!!get('SELECT 1 FROM phone_numbers WHERE phone_number_id=?',pn);
  const notFound=res=>res.status(404).json({error:'المورد غير متاح لهذا القسم'});
  const denied=res=>res.status(403).json({error:'صلاحية المدير مطلوبة لهذه العملية المشتركة'});
  const invalid=res=>res.status(400).json({error:'القسم أو البيانات غير صالحة'});
  const csv=(res,name,header,rows)=>{
    const cell=v=>{let t=String(v??'');if(/^[\s]*[=+@-]/.test(t))t="'"+t;return '"'+t.replaceAll('"','""')+'"';};
    res.set('Content-Type','text/csv; charset=utf-8').set('Content-Disposition',`attachment; filename="${name}"`).send('\uFEFF'+[header,...rows].map(r=>r.map(cell).join(',')).join('\n'));
  };
  function contacts(pn) {
    return all(`SELECT a.phone, COALESCE(d.name,c.name) name, COALESCE(d.tags,'') tags,
       COALESCE(d.notes,'') notes, COALESCE(d.opted_out,0) opted_out,
       MIN(a.created_at) created_at, ? phone_number_id
       FROM (SELECT wa_id phone,COALESCE(last_message_at,0) created_at FROM conversations WHERE phone_number_id=?
         UNION SELECT phone,created_at FROM department_contacts WHERE phone_number_id=?) a
       LEFT JOIN conversations c ON c.wa_id=a.phone AND c.phone_number_id=?
       LEFT JOIN department_contacts d ON d.phone=a.phone AND d.phone_number_id=? GROUP BY a.phone
       ORDER BY created_at DESC`,pn,pn,pn,pn,pn).map(c=>({...c,opted_out:s.isOptedOut(c.phone,pn)?1:0}));
  }
  const findContact=(pn,phone)=>contacts(pn).find(c=>c.phone===phone);
  function saveContact(pn,phone,values={}) {
    const old=findContact(pn,phone);
    run(`INSERT INTO department_contacts(phone_number_id,phone,name,tags,opted_out,notes,created_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(phone_number_id,phone) DO UPDATE SET
      name=excluded.name,tags=excluded.tags,opted_out=excluded.opted_out,notes=excluded.notes`,
      pn,phone,values.name??old?.name??null,values.tags??old?.tags??'',values.opted_out??old?.opted_out??0,
      values.notes??old?.notes??'',old?.created_at||Date.now());
  }
  function templateNames(pn) {
    return all(`SELECT name FROM department_templates WHERE phone_number_id=?
      UNION SELECT template_name name FROM campaigns WHERE phone_number_id=?`,pn,pn).map(r=>r.name);
  }
  function summary(pn) {
    const cs=contacts(pn);
    return {
      perDay:all(`SELECT date(created_at/1000,'unixepoch') day,SUM(direction='inbound') inbound,
        SUM(direction='outbound') outbound FROM messages WHERE phone_number_id=? AND created_at>=? GROUP BY day ORDER BY day DESC`,pn,Date.now()-14*864e5),
      totals:get(`SELECT SUM(direction='inbound') inbound,SUM(direction='outbound') outbound,SUM(bot=1) bot_replies FROM messages WHERE phone_number_id=?`,pn),
      campaigns:get(`SELECT COUNT(*) total,SUM(status='done') done,SUM(status='running') running,SUM(status='scheduled') scheduled FROM campaigns WHERE phone_number_id=?`,pn),
      recipients:get(`SELECT SUM(r.status IN('sent','delivered','read')) sent,SUM(r.status='delivered') delivered,
        SUM(r.status='read') read,SUM(r.status='failed') failed,SUM(r.status='skipped') skipped
        FROM campaign_recipients r JOIN campaigns c ON c.id=r.campaign_id WHERE c.phone_number_id=?`,pn),
      contacts:{total:cs.length,opted_out:cs.filter(c=>c.opted_out).length},
      topConversations:all(`SELECT wa_id,COUNT(*) messages FROM messages WHERE phone_number_id=? GROUP BY wa_id ORDER BY messages DESC LIMIT 5`,pn)
    };
  }
  function usage(pn) {
    const range=since=>get(`SELECT COALESCE(SUM(direction='inbound'),0) inbound,
      COALESCE(SUM(direction='outbound' AND bot=0),0) outbound,COALESCE(SUM(direction='outbound' AND bot=1),0) bot
      FROM messages WHERE phone_number_id=? AND created_at>=?`,pn,since);
    const cs=contacts(pn),now=Date.now(),start=now-((now+108e5)%864e5);
    return {today:range(start),last7:range(now-7*864e5),last30:range(now-30*864e5),
      perNumber:all(`SELECT m.phone_number_id,p.label,SUM(m.direction='inbound') inbound,SUM(m.direction='outbound') outbound
        FROM messages m LEFT JOIN phone_numbers p ON p.phone_number_id=m.phone_number_id WHERE m.phone_number_id=? GROUP BY m.phone_number_id`,pn),
      conversations:get('SELECT COUNT(*) n FROM conversations WHERE phone_number_id=?',pn).n,
      openConversations:get("SELECT COUNT(*) n FROM conversations WHERE phone_number_id=? AND status='open'",pn).n,
      contacts:cs.length,optedOut:cs.filter(c=>c.opted_out).length,
      csat:{...get('SELECT COUNT(*) count,ROUND(AVG(rating),1) avg FROM csat_ratings WHERE phone_number_id=?',pn),
        distribution:all('SELECT rating,COUNT(*) count FROM csat_ratings WHERE phone_number_id=? GROUP BY rating',pn)},
      campaignMessages:summary(pn).recipients.sent??0};
  }
  // All API-key users are checked before the session-authenticated route boundary.
  app.use('/api', (req,res,next)=>{
    if(req.path!=='/outbound/send')return next();
    if(req.method!=='POST')return denied(res);
    const key=String(req.get('x-api-key')??'');
    const row=get('SELECT id FROM api_keys WHERE key_hash=?',createHash('sha256').update(key).digest('hex'));
    if(!key||!row)return res.status(401).json({error:'مفتاح API غير صالح'});
    const pn=get('SELECT phone_number_id FROM api_key_departments WHERE key_id=?',row.id)?.phone_number_id;
    if(pn){
      if(!exists(pn))return denied(res);
      if(req.body?.phone_number_id&&String(req.body.phone_number_id)!==pn)return denied(res);
      req.body.phone_number_id=pn;
      if(req.body?.template_name&&!templateNames(pn).includes(req.body.template_name))return denied(res);
    }
    const targetPn=pn||req.body?.phone_number_id||s.defaultPhoneNumberId();
    if(!targetPn||!exists(String(targetPn)))return invalid(res);
    if(!s.isConnectedPn(targetPn))return res.status(400).json({error:'القسم غير متصل'});
    if(s.isOptedOut(String(req.body?.to??'').replace(/\D/g,''),targetPn))return denied(res);
    return next();
  });
  app.use('/api',(req,res,next)=>{
    const path=req.path,method=req.method==='HEAD'?'GET':req.method;
    if(!req.agent)return next(); // Only public login/health/outbound bypass the earlier session gate.
    const admin=req.agent.role==='admin';
    const pn=admin?String(req.query.pn||req.body?.pn||''):String(req.agent.phone_number_id||'');
    if(!admin&&(!pn||!exists(pn))){
      if((path==='/me'&&method==='GET')||(path==='/auth/logout'&&method==='POST'))return next();
      return res.status(403).json({error:'حساب الموظف غير مربوط بقسم صالح. راجع المدير'});
    }
    // Reject conflicting/ambiguous selectors even on a route that does not use them.
    if(!admin){
      for(const obj of [req.query,Buffer.isBuffer(req.body)?null:req.body])for(const k of ['pn','phone_number_id','from_phone_number_id']){
        if(obj?.[k]!=null&&obj[k]!==''&&(typeof obj[k]!=='string'||obj[k]!==pn))return denied(res);
      }
    }
    const select=admin?pn:pn;
    if(select&&!exists(select))return invalid(res);
    // Admin-only shared-resource management; explicit department template grants cost nothing.
    let match=/^\/department-access\/([^/]+)$/.exec(path);
    if(match){
      if(!admin)return denied(res);
      const target=decodeURIComponent(match[1]);if(!exists(target))return invalid(res);
      if(method==='POST'){
        const names=Array.isArray(req.body?.templates)?[...new Set(req.body.templates.map(String))]:null;
        if(!names||names.length>500||names.some(n=>!/^[_a-z0-9]+$/.test(n)))return invalid(res);
        db.exec('BEGIN');try{run('DELETE FROM department_templates WHERE phone_number_id=?',target);
          for(const name of names)run('INSERT INTO department_templates VALUES(?,?)',target,name);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
      }else if(method!=='GET')return denied(res);
      return res.json({phone_number_id:target,templates:templateNames(target)});
    }
    if(path==='/keys'&&admin){
      if(method==='GET')return res.json({keys:s.listApiKeys().map(k=>({...k,phone_number_id:get('SELECT phone_number_id FROM api_key_departments WHERE key_id=?',k.id)?.phone_number_id??null}))});
      if(method==='POST'){
        const target=String(req.body?.phone_number_id||'');
        if((!target&&req.body?.all_departments!==true)||(target&&!exists(target)))return invalid(res);
        const label=String(req.body?.label||'').trim();if(!label)return invalid(res);
        const key='wk_'+randomBytes(18).toString('hex');
        db.exec('BEGIN');let id;try{id=s.createApiKey(label,createHash('sha256').update(key).digest('hex'));
          if(target)run('INSERT INTO api_key_departments VALUES(?,?)',id,target);db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        return res.json({ok:true,id,key,phone_number_id:target||null});
      }
    }
    if(admin&&/^\/agents(?:\/\d+\/dept)?$/.test(path)&&method==='POST'){
      const target=req.body?.phone_number_id;if(target&&(!exists(String(target))||typeof target!=='string'))return invalid(res);
    }
    // Original global records remain visible to the owner. Staff never inherit ambiguous legacy fields.
    const scoped=!!select;
    if(scoped&&(path==='/contacts'||path==='/contacts-export'||path.startsWith('/contacts/'))){
      if(path==='/contacts'&&method==='GET')return res.json({contacts:contacts(select)});
      if(path==='/contacts-export'&&method==='GET')return csv(res,'contacts.csv',['phone','name','tags','opted_out','created_at'],contacts(select).map(c=>[c.phone,c.name,c.tags,c.opted_out,c.created_at]));
      if(path==='/contacts/import'&&method==='POST'){
        let count=0;for(const line of String(req.body?.text??'').split(/\r?\n/)){
          const [raw,name,tags]=line.split(/[,\t]/).map(x=>x.trim());const phone=String(raw??'').replace(/\D/g,'');
          if(phone.length<8||phone.length>20)continue;saveContact(select,phone,{name,tags});count++;
        }return res.json({ok:true,count});
      }
      match=/^\/contacts\/([^/]+)(\/optout)?$/.exec(path);if(!match)return denied(res);
      const phone=decodeURIComponent(match[1]);if(!/^\d{8,20}$/.test(phone))return invalid(res);
      const old=findContact(select,phone);if(!old)return notFound(res);
      if(method==='GET'&&!match[2])return res.json(old);
      if(method==='POST'){
        if(match[2]){
          // Legacy global opt-outs are never cleared by a department employee.
          if(!req.body?.opted_out&&s.isOptedOut(phone))
            return res.status(409).json({error:'يوجد منع اشتراك عام. راجع المدير ولا تتجاوز طلب العميل'});
          saveContact(select,phone,{opted_out:req.body?.opted_out?1:0});
        }else{
          const v={};for(const key of ['name','notes'])if(req.body?.[key]!==undefined)v[key]=String(req.body[key]);
          if(Array.isArray(req.body?.tags))v.tags=req.body.tags.map(String).map(t=>t.trim()).filter(Boolean).join(' ');
          saveContact(select,phone,v);
        }
        return res.json({ok:true,contact:findContact(select,phone)});
      }
      // Do not pretend to erase conversation-derived contacts or their consent history.
      return denied(res);
    }
    match=/^\/conversations\/([^/]+)\/([^/]+)$/.exec(path);
    if(match){
      const wa=decodeURIComponent(match[1]),action=match[2],target=select||s.defaultPhoneNumberId();
      if(!admin){
        if(action==='transfer')return denied(res);
        if(!get('SELECT 1 FROM conversations WHERE phone_number_id=? AND wa_id=?',pn,wa))return notFound(res);
        req.query.pn=pn;if(!Buffer.isBuffer(req.body)){req.body??={};req.body.pn=pn;req.body.phone_number_id=pn;}
        if(action==='assign'&&req.body?.agent_id){const a=s.getAgent(Number(req.body.agent_id));if(!a||!a.active||a.phone_number_id!==pn)return notFound(res);}
        if(action==='reply'){
          if(!s.isConnectedPn(pn))return invalid(res);
          if(req.body?.quoted_id){const q=s.getMessage(Number(req.body.quoted_id));if(!q||q.phone_number_id!==pn||q.wa_id!==wa)return notFound(res);}
          if(req.body?.media_id&&!get('SELECT 1 FROM department_media WHERE phone_number_id=? AND media_id=?',pn,String(req.body.media_id))&&!get('SELECT 1 FROM messages WHERE phone_number_id=? AND media_id=?',pn,String(req.body.media_id)))return notFound(res);
        }
      }
      if(action==='notes'&&['GET','POST'].includes(method)){
        if(!target||!exists(target))return invalid(res);
        if(!get('SELECT 1 FROM conversations WHERE phone_number_id=? AND wa_id=?',target,wa))return notFound(res);
        if(method==='GET'){
          const rows=all('SELECT * FROM department_notes WHERE phone_number_id=? AND wa_id=? ORDER BY created_at,id',target,wa);
          const legacy=admin?s.listNotes(wa).map(n=>({...n,legacy_unscoped:true})):[];
          return res.json({notes:[...legacy,...rows]});
        }
        const body=String(req.body?.body??'').trim();if(!body||body.length>16000)return invalid(res);
        const id=Number(run('INSERT INTO department_notes(phone_number_id,wa_id,agent_name,body,created_at) VALUES(?,?,?,?,?)',target,wa,req.agent.name,body,Date.now()).lastInsertRowid);
        return res.json({ok:true,id});
      }
      if(!admin)return ((action==='messages'&&method==='GET')||(['assign','archive','labels','bot','status','reply'].includes(action)&&method==='POST'))?next():denied(res);
    }
    if(scoped&&(path==='/canned'||/^\/canned\/\d+$/.test(path))){
      if(path==='/canned'&&method==='GET')return res.json({canned:all('SELECT * FROM department_canned WHERE phone_number_id=? ORDER BY id',select)});
      if(path==='/canned'&&method==='POST'){
        const title=String(req.body?.title??'').trim(),body=String(req.body?.body??'').trim();if(!title||!body)return invalid(res);
        return res.json({ok:true,id:Number(run('INSERT INTO department_canned(phone_number_id,title,body,created_at) VALUES(?,?,?,?)',select,title,body,Date.now()).lastInsertRowid)});
      }
      const id=Number(path.split('/').at(-1));if(method==='DELETE'&&get('SELECT 1 FROM department_canned WHERE id=? AND phone_number_id=?',id,select)){run('DELETE FROM department_canned WHERE id=? AND phone_number_id=?',id,select);return res.json({ok:true});}
      return notFound(res);
    }
    if(!admin||(scoped&&path.startsWith('/bot'))){
      if(path==='/bot'&&method==='GET')return res.json({enabled:s.departmentBotEnabled(pn),rules:s.listBotRules().filter(r=>r.phone_number_id===pn||(!r.phone_number_id&&pn===s.defaultPhoneNumberId()))});
      if(path==='/bot/toggle'&&method==='POST'){s.setSetting(`department:${pn}:bot_enabled`,req.body?.enabled?'1':'0');return res.json({ok:true,enabled:s.departmentBotEnabled(pn)});}
      if(['/bot/welcome','/bot/after-hours'].includes(path)){
        const welcome=path.endsWith('/welcome'),prefix=welcome?'welcome':'after_hours';
        if(method==='POST'){
          if(req.body?.enabled!==undefined)s.setSetting(`department:${pn}:${prefix}_enabled`,req.body.enabled?'1':'0');
          if(req.body?.message!==undefined){s.setSetting(`department:${pn}:${prefix}_message`,String(req.body.message));s.setPhoneNumberGreetings(pn,{[prefix+'_message']:String(req.body.message)});}
          if(!welcome)for(const key of ['work_start','work_end','work_days'])if(req.body?.[key]!==undefined)s.setSetting(`department:${pn}:${key}`,String(req.body[key]));
        }else if(method!=='GET')return denied(res);
        const out={enabled:s.departmentSetting(pn,prefix+'_enabled')==='1',message:s.departmentSetting(pn,prefix+'_message')};
        if(!welcome)for(const k of ['work_start','work_end','work_days'])out[k]=s.departmentSetting(pn,k);
        return res.json(out);
      }
      if(path==='/phone-numbers'&&method==='GET')return res.json({phone_numbers:s.listPhoneNumbers().filter(p=>p.phone_number_id===pn),default_id:pn});
      match=/^\/phone-numbers\/([^/]+)\/(label|messages)$/.exec(path);
      if(match&&method==='POST'){
        if(decodeURIComponent(match[1])!==pn)return notFound(res);
        // Legacy handlers return all numbers after writes. Filter the response as well.
        const json=res.json.bind(res);res.json=data=>json({...data,...(data.phone_numbers?{phone_numbers:data.phone_numbers.filter(p=>p.phone_number_id===pn)}:{})});return next();
      }
      if(path==='/media/'+path.split('/').at(-1)&&/^\/media\/\d+$/.test(path)&&method==='GET'){
        const m=s.getMessage(Number(path.split('/').at(-1)));return m?.phone_number_id===pn?next():notFound(res);
      }
      if(path==='/upload'&&method==='POST'){
        if(!s.isConnectedPn(pn))return invalid(res);req.query.pn=pn;
        const json=res.json.bind(res);res.json=data=>{if(data?.media_id)run('INSERT OR IGNORE INTO department_media VALUES(?,?,?)',pn,String(data.media_id),Date.now());return json(data);};return next();
      }
      if(path==='/business-profile'&&['GET','POST'].includes(method)){req.query.pn=pn;req.body??={};req.body.phone_number_id=pn;return next();}
      if(path==='/templates'&&method==='GET'){
        const allow=new Set(templateNames(pn));const json=res.json.bind(res);res.json=data=>json({...data,templates:(data.templates??[]).filter(t=>allow.has(t.name))});return next();
      }
      if(['/campaigns','/quick-send'].includes(path)&&method==='POST'){
        if(!templateNames(pn).includes(req.body?.template_name))return denied(res);
        if(!s.isConnectedPn(pn))return invalid(res);req.body.phone_number_id=pn;
        if(req.body.tag){const tag=String(req.body.tag).trim().toLowerCase();const own=contacts(pn).filter(c=>!c.opted_out&&c.tags.toLowerCase().split(/\s+/).includes(tag)).map(c=>c.phone);
          req.body.numbers=[req.body.numbers??'',...own].join('\n');delete req.body.tag;}
        return next();
      }
      match=/^\/campaigns\/(\d+)(?:\/(start|retry-failed))?$/.exec(path)||/^\/export\/campaigns\/(\d+)\.csv$/.exec(path);
      if(match){const c=s.getCampaign(Number(match[1]));if(!c||c.campaign.phone_number_id!==pn)return notFound(res);
        return (['GET','DELETE'].includes(method)||(['start','retry-failed'].includes(match[2])&&method==='POST'))?next():denied(res);}
      if(path==='/campaigns'&&method==='GET')return next();
      if(path==='/bot/rules'&&method==='POST'){req.body.phone_number_id=pn;return next();}
      match=/^\/bot\/rules\/(\d+)$/.exec(path);if(match&&method==='DELETE')return s.getBotRule(Number(match[1]))?.phone_number_id===pn?next():notFound(res);
      if(path==='/reports/summary'&&method==='GET')return res.json(summary(pn));
      if(path==='/usage'&&method==='GET')return res.json(usage(pn));
      if(path==='/export/messages-daily.csv'&&method==='GET')return csv(res,'messages-daily.csv',['day','inbound','outbound'],summary(pn).perDay.map(d=>[d.day,d.inbound,d.outbound]));
      if(path==='/export/campaigns.csv'&&method==='GET')return csv(res,'campaigns.csv',['id','name','template','status','total','sent','delivered','read','failed'],s.listCampaigns().filter(c=>c.phone_number_id===pn).map(c=>[c.id,c.name,c.template_name,c.status,c.total,c.sent,c.delivered,c.read,c.failed]));
      if(path==='/numbers/quality'&&method==='GET'){
        const json=res.json.bind(res);res.json=data=>json({...data,quality:(data.quality??[]).filter(p=>p.phone_number_id===pn)});return next();
      }
      if((path==='/me'&&method==='GET')||(path==='/auth/logout'&&method==='POST')||(path==='/conversations'&&method==='GET'))return next();
      return denied(res); // New or overlooked routes do not inherit employee access.
    }
    return next();
  });
  return {contacts,summary,usage};
          }
