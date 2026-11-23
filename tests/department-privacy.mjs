import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {randomInt,scryptSync,createHmac} from 'node:crypto';
const source=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root=mkdtempSync(path.join(tmpdir(),'department-privacy-test-'));
cpSync(path.join(source,'src'),path.join(root,'src'),{recursive:true});
cpSync(path.join(source,'public'),path.join(root,'public'),{recursive:true});
writeFileSync(path.join(root,'package.json'),'{"type":"module"}');
symlinkSync(path.join(source,'node_modules'),path.join(root,'node_modules'),'dir');
// All WhatsApp functions are replaced in this isolated copy. No provider credentials or requests.
writeFileSync(path.join(root,'src/whatsapp.js'),`
import {appendFileSync} from 'node:fs';
const call=(name,args)=>{appendFileSync('data/transports.jsonl',JSON.stringify({name,args})+'\\n');return {messages:[{id:'stub-'+Date.now()}]};};
export const sendText=async(...a)=>call('sendText',a),sendTemplate=async(...a)=>call('sendTemplate',a),sendTemplateEx=async(...a)=>call('sendTemplateEx',a),sendMedia=async(...a)=>call('sendMedia',a),sendMediaId=async(...a)=>call('sendMediaId',a),sendInteractive=async(...a)=>call('sendInteractive',a);
export const uploadMedia=async(...a)=>{call('uploadMedia',[a[1],a[2],a[3]]);return 'upload-'+a[3];};
export const getMediaUrl=async id=>'https://fixture.invalid/'+id,downloadMedia=async()=>({buf:Buffer.from('isolated fixture media'),contentType:'text/plain'});
export const listTemplates=async()=>[{name:'template_a',status:'APPROVED',language:'ar',components:[],body:'PRIVATE_TEMPLATE_A'},{name:'template_b',status:'APPROVED',language:'ar',components:[],body:'PRIVATE_TEMPLATE_B'},{name:'template_unassigned',status:'APPROVED',language:'ar',components:[],body:'PRIVATE_TEMPLATE_GLOBAL'}];
export const createTemplate=async(...a)=>call('createTemplate',a),deleteTemplate=async(...a)=>call('deleteTemplate',a);
export const getBusinessProfile=async pn=>({description:'PROFILE_'+pn}),updateBusinessProfile=async(...a)=>call('updateBusinessProfile',a),getNumberQuality=async pn=>({quality_rating:'QUALITY_'+pn}),verifyNumberForLink=async(id,display)=>({id,display_number:display});
`);
process.chdir(root);process.env.PHONE_NUMBER_ID='dept-a';
const s=await import(pathToFileURL(path.join(root,'src/db.js'))),db=s.db;
const {createDepartmentPrivacy}=await import(pathToFileURL(path.join(root,'src/department-privacy.js')));
// Initialize additive tables exactly as the live app does, without invoking any transport.
createDepartmentPrivacy({app:{use(){}}});
s.addPendingPhoneNumber('dept-b','PRIVATE_DEPT_B','966500000002');s.addPendingPhoneNumber('dept-c','PRIVATE_DEPT_C');
db.prepare('UPDATE phone_numbers SET connected=1').run();
const pass='isolated-password',salt='fixture-salt',hash=salt+':'+scryptSync(pass,salt,32).toString('hex');
for(const [username,role,pn] of [['owner','admin',null],['a','agent','dept-a'],['b','agent','dept-b'],['unassigned','agent',null],['invalid','agent','missing']])s.createAgent({username,name:username,passHash:hash,role,phoneNumberId:pn});
const shared='966511111111',onlyA='966522222222',onlyB='966533333333';
for(const [pn,phone,name] of [['dept-a',shared,'PRIVATE_NAME_A'],['dept-b',shared,'PRIVATE_NAME_B'],['dept-a',onlyA,'PRIVATE_ONLY_A'],['dept-b',onlyB,'PRIVATE_ONLY_B']])s.upsertInbound({waId:phone,phoneNumberId:pn,name,waMessageId:'in-'+pn+'-'+phone,type:'image',body:'PRIVATE_BODY_'+pn,mediaId:'media-'+pn+'-'+phone,ts:Date.now()/1000});
s.upsertContact({phone:shared,name:'LEGACY_PRIVATE_NAME',tags:'LEGACY_PRIVATE_TAG'});s.updateContact(shared,{notes:'LEGACY_PRIVATE_CONTACT_NOTE'});
s.upsertContact({phone:onlyB,name:'PRIVATE_GLOBAL_ONLY_B',tags:'PRIVATE_GLOBAL_TAG_B'});
s.addNote(shared,'legacy-admin','LEGACY_PRIVATE_TEAM_NOTE');s.addCanned('LEGACY_PRIVATE_CANNED','LEGACY_PRIVATE_CANNED_BODY');
const ruleA=Number(s.addBotRule('keyword_a','PRIVATE_RULE_A','keyword',null,'dept-a'));
const ruleB=Number(s.addBotRule('keyword_b','PRIVATE_RULE_B','keyword',null,'dept-b'));
const ruleG=Number(s.addBotRule('legacy','PRIVATE_RULE_LEGACY','keyword',null,null));
s.setSetting('welcome_message','LEGACY_PRIVATE_WELCOME');s.setSetting('welcome_enabled','1');
const campA=s.createCampaign({name:'PRIVATE_CAMPAIGN_A',templateName:'template_a',numbers:[onlyA],phoneNumberId:'dept-a'});
const campB=s.createCampaign({name:'PRIVATE_CAMPAIGN_B',templateName:'template_b',numbers:[onlyB],phoneNumberId:'dept-b'});
const campG=s.createCampaign({name:'LEGACY_PRIVATE_CAMPAIGN',templateName:'template_unassigned',numbers:[onlyB],phoneNumberId:null});
const aId=db.prepare("SELECT id FROM messages WHERE phone_number_id='dept-a' AND wa_id=?").get(shared).id;
const bId=db.prepare("SELECT id FROM messages WHERE phone_number_id='dept-b' AND wa_id=?").get(shared).id;
const bAgent=s.getAgentByUsername('b').id;
s.addCsatRating(onlyA,'dept-a',5);s.addCsatRating(onlyB,'dept-b',1);
mkdirSync('data/media',{recursive:true});writeFileSync('data/media/'+aId,'PRIVATE_MEDIA_A');writeFileSync('data/media/'+bId,'PRIVATE_MEDIA_B');
writeFileSync('data/media/'+aId+'.ct','text/plain');writeFileSync('data/media/'+bId+'.ct','text/plain');
const port=randomInt(34000,49000),env={PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),AUTH_SECRET:'isolated-test-signing-secret',PHONE_NUMBER_ID:'dept-a',WABA_ID:'fixture',WHATSAPP_TOKEN:'fixture-not-real',VERIFY_TOKEN:'fixture',META_APP_SECRET:'synthetic-webhook-only',WEBHOOK_SIGNATURE_ENFORCE:'1',NODE_ENV:'production'};
const child=spawn(process.execPath,['src/server.js'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:'+port,cookies={};let assertions=0;const evidence=[];
const check=(ok,label)=>{assert.ok(ok,label);assertions++;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const calls=()=>existsSync('data/transports.jsonl')?readFileSync('data/transports.jsonl','utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
async function req(who,url,{method='GET',body,raw,headers={}}={}){
 const r=await fetch(base+url,{method,headers:{...(cookies[who]?{cookie:cookies[who]}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):raw});const text=await r.text();let data;try{data=JSON.parse(text);}catch{}evidence.push({who,method,url,status:r.status});return {status:r.status,text,data,headers:r.headers};
}
const tableState=()=>JSON.stringify(Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()])));
try{
 for(let i=0;i<100;i++){try{await fetch(base+'/api/health');break;}catch{if(child.exitCode!=null)throw Error(logs);await sleep(40);}}
 for(const who of ['owner','a','b','unassigned','invalid']){const r=await req(who,'/api/auth/login',{method:'POST',body:{username:who,password:pass}});check(r.status===200,'login '+who);cookies[who]=r.headers.get('set-cookie').split(';')[0];}
 const noAuth=await req('none','/api/conversations');check(noAuth.status===401,'unauthenticated');
 // Every existing route family is explicitly denied for unassigned/invalid employees.
 const denyUnassigned=[['GET','/api/conversations'],['GET','/api/phone-numbers'],['GET',`/api/conversations/${shared}/messages`],['POST',`/api/conversations/${shared}/reply`,{body:'x'}],['GET',`/api/media/${aId}`],['POST','/api/upload'],['GET','/api/contacts'],['POST','/api/contacts/import',{text:'966544444444,No'}],['GET','/api/contacts-export'],['GET','/api/reports/summary'],['GET','/api/usage'],['GET','/api/campaigns'],['GET','/api/templates'],['GET','/api/business-profile'],['GET','/api/bot'],['POST','/api/bot/toggle',{enabled:false}],['GET','/api/canned'],['GET','/api/webhook-events'],['GET','/api/admin/backup'],['GET','/api/keys'],['GET','/api/data-transfer?pn=dept-a'],['DELETE','/api/phone-numbers/dept-b'],['GET','/api/numbers/quality']];
 const before=tableState(),transportBefore=calls().length;
 for(const who of ['unassigned','invalid'])for(const [method,url,body] of denyUnassigned)check((await req(who,url,{method,body})).status===403,'unassigned/invalid deny '+who+' '+url);
 const cross=[['GET',`/api/conversations/${shared}/messages?pn=dept-b`],['GET',`/api/conversations/${onlyB}/messages`],['POST',`/api/conversations/${onlyB}/reply`,{body:'no'}],['POST',`/api/conversations/${shared}/reply`,{phone_number_id:'dept-b',body:'no'}],['POST',`/api/conversations/${shared}/reply`,{quoted_id:bId,body:'no'}],['POST',`/api/conversations/${shared}/reply`,{media_id:'media-dept-b-'+shared,body:'no'}],['GET',`/api/media/${bId}`],['GET',`/api/conversations/${onlyB}/notes`],['POST',`/api/conversations/${onlyB}/notes`,{body:'no'}],['POST',`/api/conversations/${shared}/assign`,{agent_id:bAgent}],['POST',`/api/conversations/${onlyB}/archive`,{archived:true}],['POST',`/api/conversations/${onlyB}/labels`,{labels:'no'}],['POST',`/api/conversations/${onlyB}/bot`,{enabled:false}],['POST',`/api/conversations/${onlyB}/status`,{status:'closed'}],['POST',`/api/conversations/${shared}/transfer`,{from_phone_number_id:'dept-a',to_phone_number_id:'dept-b'}],['GET',`/api/contacts/${onlyB}`],['POST',`/api/contacts/${onlyB}`,{name:'no'}],['POST',`/api/contacts/${onlyB}/optout`,{opted_out:true}],['DELETE',`/api/contacts/${onlyB}`],['POST','/api/bot/rules',{keyword:'no',response:'no',phone_number_id:'dept-b'}],['DELETE',`/api/bot/rules/${ruleB}`],['DELETE',`/api/bot/rules/${ruleG}`],['POST','/api/phone-numbers/dept-b/messages',{welcome_message:'no'}],['POST','/api/phone-numbers/dept-b/label',{label:'no'}],['DELETE','/api/phone-numbers/dept-a'],['POST','/api/phone-numbers/dept-a/connect',{phone_number_id:'966999999999'}],['POST','/api/templates',{name:'no'}],['DELETE','/api/templates/template_b'],['POST','/api/templates/test',{to:onlyA,template_name:'template_a'}],['GET',`/api/campaigns/${campB}`],['POST',`/api/campaigns/${campB}/start`,{}],['POST',`/api/campaigns/${campB}/retry-failed`,{}],['DELETE',`/api/campaigns/${campB}`],['GET',`/api/export/campaigns/${campB}.csv`],['GET',`/api/campaigns/${campG}`],['POST',`/api/campaigns/${campG}/start`,{}],['DELETE',`/api/campaigns/${campG}`],['GET',`/api/export/campaigns/${campG}.csv`],['POST','/api/campaigns',{name:'no',template_name:'template_b',numbers:onlyA}],['POST','/api/quick-send',{template_name:'template_b',numbers:onlyA}],['GET','/api/business-profile?pn=dept-b'],['POST','/api/business-profile',{phone_number_id:'dept-b',about:'no'}],['POST','/api/upload?pn=dept-b'],['GET','/api/keys'],['POST','/api/keys',{label:'no'}],['DELETE','/api/keys/1'],['GET','/api/agents'],['POST','/api/agents',{username:'no'}],['GET','/api/agents/stats'],['POST',`/api/agents/${bAgent}/dept`,{phone_number_id:'dept-a'}],['POST',`/api/agents/${bAgent}/toggle`,{active:false}],['GET','/api/admin/backup'],['GET','/api/admin/daily-summary'],['GET','/api/webhook-events'],['GET','/api/data-transfer?pn=dept-a'],['GET','/api/data-transfer/export?pn=dept-b'],['POST','/api/data-transfer/preview',{phone_number_id:'dept-a',rows:[]}],['POST','/api/data-transfer/commit',{phone_number_id:'dept-a'}],['POST','/api/department-access/dept-a',{templates:['template_b']}],['GET','/api/department-access/dept-b'],['GET','/api/new-future-route']];
 for(const [method,url,body] of cross){const r=await req('a',url,{method,body});check([403,404].includes(r.status),'cross deny '+method+' '+url+' got '+r.status);}
 for(const [method,url,body] of cross){
   const swap=v=>typeof v==='string'?v.replaceAll('dept-a','__pn__').replaceAll('dept-b','dept-a').replaceAll('__pn__','dept-b').replaceAll(onlyA,'__phone__').replaceAll(onlyB,onlyA).replaceAll('__phone__',onlyB).replaceAll('template_a','__template__').replaceAll('template_b','template_a').replaceAll('__template__','template_b'):v;
   let other=swap(url).replace(`/api/media/${bId}`,`/api/media/${aId}`).replace(`/bot/rules/${ruleB}`,`/bot/rules/${ruleA}`).replace(`/campaigns/${campB}`,`/campaigns/${campA}`);
   const b=body?Object.fromEntries(Object.entries(body).map(([k,v])=>[k,k==='quoted_id'?aId:k==='agent_id'?s.getAgentByUsername('a').id:swap(v)])):undefined;
   const r=await req('b',other,{method,body:b});check([403,404].includes(r.status),'reverse cross deny '+method+' '+other+' got '+r.status);
 }
 for(const selector of ['pn=dept-b&pn=dept-a','pn%5B%5D=dept-a','phone_number_id=dept-b'])check([400,403].includes((await req('a','/api/conversations?'+selector)).status),'ambiguous selector rejected');
 check(tableState()===before,'negative matrix leaves every database table unchanged');check(calls().length===transportBefore,'negative matrix invokes no transport');
 // Positive reads, including shared recipient in two departments and all report/export families.
 for(const who of ['a','b']){
   const other=who==='a'?'B':'A';
   for(const url of ['/api/phone-numbers','/api/conversations',`/api/conversations/${shared}/messages`,'/api/contacts',`/api/contacts/${shared}`,'/api/contacts-export','/api/reports/summary','/api/usage','/api/export/messages-daily.csv','/api/export/campaigns.csv','/api/campaigns','/api/bot','/api/bot/welcome','/api/bot/after-hours','/api/canned','/api/templates','/api/business-profile','/api/numbers/quality',`/api/conversations/${shared}/notes`]){
     const r=await req(who,url);check(r.status===200,'own read '+who+' '+url+' got '+r.status);check(!r.text.includes('PRIVATE_NAME_'+other)&&!r.text.includes('PRIVATE_RULE_'+other)&&!r.text.includes('PRIVATE_CAMPAIGN_'+other)&&!r.text.includes('PRIVATE_TEMPLATE_'+other),'cross content absent '+who+' '+url);
     if(who==='b')check(!r.text.includes('LEGACY_PRIVATE'),'legacy content isolated from nondefault '+url);
     if(url.includes('contacts')||url.includes('notes')||url==='/api/canned')check(!r.text.includes('LEGACY_PRIVATE'),'ambiguous shared fields admin-only '+url);
   }
 }
 check((await req('a',`/api/media/${aId}`)).text==='PRIVATE_MEDIA_A','own cached media');check((await req('b',`/api/media/${bId}`)).text==='PRIVATE_MEDIA_B','other own cached media');
 check((await req('a','/api/usage')).data.csat.avg===5&&(await req('b','/api/usage')).data.csat.avg===1,'CSAT isolated');
 // Only a department's own rows may be changed.
 const foreign=()=>JSON.stringify({messages:db.prepare("SELECT * FROM messages WHERE phone_number_id='dept-b'").all(),conversations:db.prepare("SELECT * FROM conversations WHERE phone_number_id='dept-b'").all(),contacts:db.prepare('SELECT * FROM contacts').all(),legacyNotes:db.prepare('SELECT * FROM convo_notes').all(),legacyCanned:db.prepare('SELECT * FROM canned_responses').all(),global:s.getBotSettings(),welcome:s.getSetting('welcome_message')});
 const foreignBefore=foreign();
 for(const action of ['archive','labels','bot','status'])check((await req('a',`/api/conversations/${shared}/${action}`,{method:'POST',body:{archived:true,labels:'own-label',enabled:false,status:'open'}})).status===200,'own write '+action);
 check((await req('a',`/api/conversations/${shared}/assign`,{method:'POST',body:{agent_id:s.getAgentByUsername('a').id}})).status===200,'own assignment');
 check((await req('a',`/api/conversations/${shared}/notes`,{method:'POST',body:{body:'PRIVATE_NEW_NOTE_A'}})).status===200,'own new note');
 check(!(await req('b',`/api/conversations/${shared}/notes`)).text.includes('PRIVATE_NEW_NOTE_A'),'notes shared recipient isolation');
 check((await req('a',`/api/contacts/${shared}`,{method:'POST',body:{name:'PRIVATE_NEW_NAME_A',tags:['own-tag'],notes:'PRIVATE_NEW_CONTACT_A'}})).status===200,'own contact overlay');
 check(!(await req('b',`/api/contacts/${shared}`)).text.includes('PRIVATE_NEW_'),'contact shared recipient isolation');
 check((await req('a','/api/contacts/import',{method:'POST',body:{text:'966544444444,PRIVATE_IMPORTED_A,own-tag'}})).data.count===1,'own legacy CSV contact import');
 check(!(await req('b','/api/contacts')).text.includes('PRIVATE_IMPORTED_A'),'import scope');
 const canned=await req('a','/api/canned',{method:'POST',body:{title:'PRIVATE_CANNED_A',body:'own'}});check(canned.status===200,'own canned add');
 check((await req('b',`/api/canned/${canned.data.id}`,{method:'DELETE'})).status===404,'cross canned delete');
 check(!(await req('b','/api/canned')).text.includes('PRIVATE_CANNED_A'),'canned scope');
 check((await req('a','/api/bot/toggle',{method:'POST',body:{enabled:false}})).status===200,'own bot toggle');
 check((await req('a','/api/bot/welcome',{method:'POST',body:{enabled:true,message:'PRIVATE_WELCOME_A'}})).status===200,'own welcome write');
 check((await req('a','/api/bot/after-hours',{method:'POST',body:{enabled:true,message:'PRIVATE_AFTER_A',work_start:'10:00',work_end:'18:00',work_days:'1,2'}})).status===200,'own after hours write');
 check(!(await req('b','/api/bot/welcome')).text.includes('PRIVATE_WELCOME_A'),'welcome scope');
 const greeting=await req('a','/api/phone-numbers/dept-a/messages',{method:'POST',body:{welcome_message:'PRIVATE_GREETING_A'}});check(greeting.status===200&&greeting.data.phone_numbers.length===1,'greeting write response scope');
 check(foreign()===foreignBefore,'own writes preserve all foreign and ambiguous legacy records');
 // Opt-outs: new department opt-outs are local; old global safety restrictions cannot be cleared by staff.
 check((await req('a',`/api/contacts/${shared}/optout`,{method:'POST',body:{opted_out:true}})).status===200,'department optout');
 check(s.isOptedOut(shared,'dept-a')&&!s.isOptedOut(shared,'dept-b'),'department optout no cross change');
 s.setContactOptOut(shared,true);check((await req('a',`/api/contacts/${shared}/optout`,{method:'POST',body:{opted_out:false}})).status===409,'cannot clear legacy global optout');s.setContactOptOut(shared,false);
 check((await req('a',`/api/contacts/${shared}/optout`,{method:'POST',body:{opted_out:false}})).status===200,'clear own optout only');
 // Omitted pn is pinned, never falls back to the original number for another department.
 const quick=await req('b','/api/quick-send',{method:'POST',body:{template_name:'template_b',numbers:onlyB}});check(quick.status===200,'quick send omitted pn accepted');await sleep(30);
 check(calls().some(c=>c.name==='sendTemplateEx'&&c.args[5]==='dept-b'),'quick send pins actual transport');
 check((await req('b',`/api/conversations/${shared}/reply`,{method:'POST',body:{body:'stub reply',quoted_id:bId}})).status===200,'own reply quoted own message');
 check(calls().some(c=>c.name==='sendText'&&c.args[2]==='dept-b'),'reply pins actual transport');
 check((await req('b','/api/upload?mime=text/plain&filename=fixture.txt',{method:'POST',raw:'fixture',headers:{'Content-Type':'text/plain'}})).status===200,'own upload');
 check(db.prepare("SELECT 1 FROM department_media WHERE phone_number_id='dept-b' AND media_id='upload-dept-b'").get(),'upload ownership recorded');
 check((await req('a',`/api/conversations/${shared}/reply`,{method:'POST',body:{body:'x',media_id:'upload-dept-b'}})).status===404,'cross uploaded-media reuse rejected');
 // Scoped keys are admin-created; key destination cannot be changed and session APIs remain unavailable.
 check((await req('owner','/api/keys',{method:'POST',body:{label:'missing-scope'}})).status===400,'new key requires explicit scope');
 const key=await req('owner','/api/keys',{method:'POST',body:{label:'fixture-a',phone_number_id:'dept-a'}});check(key.status===200,'scoped key create');
 check((await req('none','/api/outbound/send',{method:'POST',headers:{'x-api-key':key.data.key},body:{to:onlyA,text:'stub',phone_number_id:'dept-b'}})).status===403,'key cross send rejected');
 check((await req('none','/api/outbound/send',{method:'POST',headers:{'x-api-key':key.data.key},body:{to:onlyA,text:'stub'}})).status===200,'key omitted pn pinned');
 check(calls().at(-1).args[2]==='dept-a','key actual transport pinned');
 check((await req('none','/api/conversations',{headers:{'x-api-key':key.data.key}})).status===401,'key cannot read inbox');
 // Owner retains global access and can authorize templates without exposing other departments.
 for(const url of ['/api/admin/backup','/api/agents','/api/agents/stats','/api/admin/daily-summary','/api/contacts','/api/reports/summary','/api/campaigns','/api/templates','/api/webhook-events','/api/keys',`/api/media/${bId}`,`/api/conversations/${shared}/messages?pn=dept-b`])check((await req('owner',url)).status===200,'owner retains '+url);
 check((await req('owner','/api/contacts')).text.includes('LEGACY_PRIVATE_CONTACT_NOTE'),'owner retains ambiguous originals');
 check((await req('owner','/api/department-access/dept-b',{method:'POST',body:{templates:['template_unassigned']}})).status===200,'owner template grant');
 check((await req('b','/api/templates')).text.includes('PRIVATE_TEMPLATE_GLOBAL')&&!(await req('a','/api/templates')).text.includes('PRIVATE_TEMPLATE_GLOBAL'),'template grants scoped');
 // Signed intake: configured WABA/local connected IDs only, no payload-based number registration.
 const pnD='155555555555555';s.addPendingPhoneNumber(pnD,'SIGNED_FIXTURE');db.prepare('UPDATE phone_numbers SET connected=1 WHERE phone_number_id=?').run(pnD);
 const hook=async(value,signed=true)=>{const raw=JSON.stringify(value);return req('none','/webhook',{method:'POST',raw,headers:{'Content-Type':'application/json',...(signed?{'X-Hub-Signature-256':'sha256='+createHmac('sha256','synthetic-webhook-only').update(raw).digest('hex')}:{})}});};
 const event=(pn=pnD,waba='fixture',id='signed-inbound-fixture')=>({object:'whatsapp_business_account',entry:[{id:waba,changes:[{field:'messages',value:{metadata:{phone_number_id:pn},messages:[{id,from:'966566666666',type:'text',text:{body:'isolated signed intake'},timestamp:String(Math.floor(Date.now()/1000))}]}}]}]});
 const countMessages=()=>db.prepare('SELECT COUNT(*) n FROM messages').get().n;
 const countBefore=countMessages();check((await hook(event(),false)).status===403&&countMessages()===countBefore,'unsigned webhook rejected before processing');
 check((await hook(event())).status===200,'valid signed known-number webhook');await sleep(20);check(countMessages()===countBefore+1,'valid webhook captured exactly once');
 check((await hook(event())).status===200,'signed redelivery acknowledged');await sleep(20);check(countMessages()===countBefore+1,'duplicate message does not replay bots or inserts');
 check((await hook(event('166666666666666'))).status===200,'unknown number acknowledged without enrollment');await sleep(20);check(!s.listPhoneNumbers().some(p=>p.phone_number_id==='166666666666666')&&countMessages()===countBefore+1,'payload cannot register unexpected numbers');
 check((await hook(event(pnD,'different-waba','foreign-waba-fixture'))).status===200,'foreign WABA ignored');await sleep(20);check(countMessages()===countBefore+1,'foreign WABA cannot insert');
 const bBeforeStatus=s.getMessage(bId).status;const statusEvent={object:'whatsapp_business_account',entry:[{id:'fixture',changes:[{value:{metadata:{phone_number_id:pnD},statuses:[{id:s.getMessage(bId).wa_message_id,status:'read'}]}}]}]};await hook(statusEvent);await sleep(20);check(s.getMessage(bId).status===bBeforeStatus,'status event cannot update another number message');
 check((await req('a','/api/admin/security-status')).status===403,'security diagnostics owner only');check((await req('owner','/api/admin/security-status')).data.signature_enforced===true,'security status readiness reflects explicit configuration');
 // Live role/department changes are read on every request, not frozen in a seven-day cookie.
 s.setAgentDept(s.getAgentByUsername('a').id,'dept-c');check((await req('a','/api/conversations')).data.conversations.length===0,'department change immediately revokes prior access');
 s.setAgentActive(s.getAgentByUsername('b').id,false);check((await req('b','/api/conversations')).status===401,'deactivation invalidates session');
 check(s.matchBotRule('legacy','dept-b')===null&&s.matchBotRule('legacy','dept-a')?.id===ruleG,'legacy bot restricted to original department');
 console.log('PASS '+assertions+' assertions; '+evidence.length+' isolated real HTTP route calls; all provider functions stubbed; zero real messages.');
 writeFileSync(path.join(source,'tests/privacy-evidence.json'),JSON.stringify({assertions,calls:evidence,transport:'isolated stubs only',root},null,2));
} catch(e){console.error(logs);throw e;} finally {child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));db.close();}
