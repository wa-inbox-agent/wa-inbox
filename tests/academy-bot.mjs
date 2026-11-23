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
export const listTemplates=async()=>[{name:'vars',language:'ar',status:'APPROVED',components:[{type:'BODY',text:'Course {{1}} date {{2}}'}]},{name:'template_a',status:'APPROVED',body:'PRIVATE_TEMPLATE_A'},{name:'template_b',status:'APPROVED',body:'PRIVATE_TEMPLATE_B'},{name:'template_unassigned',status:'APPROVED',body:'PRIVATE_TEMPLATE_GLOBAL'}];
export const createTemplate=async(...a)=>call('createTemplate',a),deleteTemplate=async(...a)=>call('deleteTemplate',a);
export const getBusinessProfile=async pn=>({description:'PROFILE_'+pn}),updateBusinessProfile=async(...a)=>call('updateBusinessProfile',a),getNumberQuality=async pn=>({quality_rating:'QUALITY_'+pn}),verifyNumberForLink=async(id,display)=>({id,display_number:display});
`);
process.chdir(root);process.env.PHONE_NUMBER_ID='1226967047176539';
const s=await import(pathToFileURL(path.join(root,'src/db.js'))),db=s.db;
const {createDepartmentPrivacy}=await import(pathToFileURL(path.join(root,'src/department-privacy.js')));
// Initialize additive tables exactly as the live app does, without invoking any transport.
createDepartmentPrivacy({app:{use(){}}});
s.addPendingPhoneNumber('dept-b','PRIVATE_DEPT_B','966500000002');s.addPendingPhoneNumber('dept-c','PRIVATE_DEPT_C');
db.prepare('UPDATE phone_numbers SET connected=1').run();
const pass='isolated-password',salt='fixture-salt',hash=salt+':'+scryptSync(pass,salt,32).toString('hex');
for(const [username,role,pn] of [['owner','admin',null],['a','agent','1226967047176539'],['b','agent','dept-b'],['unassigned','agent',null],['invalid','agent','missing']])s.createAgent({username,name:username,passHash:hash,role,phoneNumberId:pn});
const shared='966511111111',onlyA='966522222222',onlyB='966533333333';
for(const [pn,phone,name] of [['1226967047176539',shared,'PRIVATE_NAME_A'],['dept-b',shared,'PRIVATE_NAME_B'],['1226967047176539',onlyA,'PRIVATE_ONLY_A'],['dept-b',onlyB,'PRIVATE_ONLY_B']])s.upsertInbound({waId:phone,phoneNumberId:pn,name,waMessageId:'in-'+pn+'-'+phone,type:'image',body:'PRIVATE_BODY_'+pn,mediaId:'media-'+pn+'-'+phone,ts:Date.now()/1000});
s.upsertContact({phone:shared,name:'LEGACY_PRIVATE_NAME',tags:'LEGACY_PRIVATE_TAG'});s.updateContact(shared,{notes:'LEGACY_PRIVATE_CONTACT_NOTE'});
s.upsertContact({phone:onlyB,name:'PRIVATE_GLOBAL_ONLY_B',tags:'PRIVATE_GLOBAL_TAG_B'});
s.addNote(shared,'legacy-admin','LEGACY_PRIVATE_TEAM_NOTE');s.addCanned('LEGACY_PRIVATE_CANNED','LEGACY_PRIVATE_CANNED_BODY');
const ruleA=Number(s.addBotRule('keyword_a','PRIVATE_RULE_A','keyword',null,'1226967047176539'));
const ruleB=Number(s.addBotRule('keyword_b','PRIVATE_RULE_B','keyword',null,'dept-b'));
const ruleG=Number(s.addBotRule('legacy','PRIVATE_RULE_LEGACY','keyword',null,null));
s.setSetting('welcome_message','LEGACY_PRIVATE_WELCOME');s.setSetting('welcome_enabled','1');
const campA=s.createCampaign({name:'PRIVATE_CAMPAIGN_A',templateName:'template_a',numbers:[onlyA],phoneNumberId:'1226967047176539'});
const campB=s.createCampaign({name:'PRIVATE_CAMPAIGN_B',templateName:'template_b',numbers:[onlyB],phoneNumberId:'dept-b'});
const campG=s.createCampaign({name:'LEGACY_PRIVATE_CAMPAIGN',templateName:'template_unassigned',numbers:[onlyB],phoneNumberId:null});
const aId=db.prepare("SELECT id FROM messages WHERE phone_number_id='1226967047176539' AND wa_id=?").get(shared).id;
const bId=db.prepare("SELECT id FROM messages WHERE phone_number_id='dept-b' AND wa_id=?").get(shared).id;
const bAgent=s.getAgentByUsername('b').id;
s.addCsatRating(onlyA,'1226967047176539',5);s.addCsatRating(onlyB,'dept-b',1);
mkdirSync('data/media',{recursive:true});writeFileSync('data/media/'+aId,'PRIVATE_MEDIA_A');writeFileSync('data/media/'+bId,'PRIVATE_MEDIA_B');
writeFileSync('data/media/'+aId+'.ct','text/plain');writeFileSync('data/media/'+bId+'.ct','text/plain');
const port=randomInt(34000,49000),env={PATH:process.env.PATH,HOME:process.env.HOME,PORT:String(port),AUTH_SECRET:'isolated-test-signing-secret',PHONE_NUMBER_ID:'1226967047176539',WABA_ID:'fixture',WHATSAPP_TOKEN:'fixture-not-real',VERIFY_TOKEN:'fixture',META_APP_SECRET:'synthetic-webhook-only',WEBHOOK_SIGNATURE_ENFORCE:'1',ACADEMY_APP_BINDING_VERIFIED:'1',NODE_ENV:'production'};
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

 const pn='1226967047176539';
 check(!s.departmentBotEnabled(pn),'migration keeps Academy OFF');
 check(s.listBotRules().every(r=>r.phone_number_id!==pn&&r.phone_number_id!==null),'Academy and default-only legacy rules replaced');
 check(s.listBotRules().some(r=>r.phone_number_id==='dept-b'&&r.keyword==='keyword_b'),'other department rule retained');
 check(s.getAgentByUsername('owner').pass_hash===hash,'login hash untouched');
 check(s.departmentSetting(pn,'work_start')==='08:00','official start');
 check(s.listConversations({role:'admin'}).length===4,'all four fixture conversations retained');
 check(db.prepare('SELECT count(*) n FROM academy_bot_content_archive').get().n===1,'old content archived');
 check((await req('b','/api/academy-bot')).status===403,'other dept cannot read management status');
 const info=await req('owner','/api/academy-bot');check(info.status===200&&info.data.catalog.length===13,'13 verified-open programs');
 const qs={template_name:'vars',language_code:'ar',numbers:'966500099999',phone_number_id:pn};
 for(const body_params of [[],['only'],['','two'],['one','two','extra']])check((await req('owner','/api/quick-send',{method:'POST',body:{...qs,body_params}})).status===400,'missing/extra/blank params blocked');
 check(calls().length===0,'negative validation no transport');
 const valid=await req('owner','/api/quick-send',{method:'POST',body:{...qs,body_params:['Course name','2026-12-01']}});check(valid.status===200,'valid stub send accepted');await sleep(50);
 check(calls().some(c=>c.name==='sendTemplateEx'&&c.args[4][0]==='Course name'),'ordered exact parameter payload');
 const {academyStep}=await import(pathToFileURL(path.join(source,'public/academy-flow.js')));
 const catalog=JSON.parse(readFileSync(path.join(source,'public/academy-catalog.json'),'utf8'));
 let out=academyStep({},'',catalog);check(out.options.length===8,'main8choices');
 out=academyStep(out.state,'2',catalog);check(out.options.some(o=>o.id.startsWith('course_')),'nested diplomas numeric choice');
 const c=out.options.find(o=>o.id.startsWith('course_'));out=academyStep(out.state,c.id,catalog);check(out.text.includes('CourseDetails/'),'verified course detail link');
 out=academyStep({},'rating',catalog);out=academyStep(out.state,'٥',catalog);check(out.rating===5,'Arabic numeric rating');
 out=academyStep({},'human',catalog);check(out.handoff&&out.state.node==='handoff','handoff flag');out=academyStep(out.state,'hello',catalog);check(out.options.length===0&&!out.rating,'handoff stays stopped');
 out=academyStep(out.state,'0',catalog);check(out.options.length===8,'preview restart navigation');
 s.setSetting('department:'+pn+':bot_enabled','1');
 const webhook=async(id,text,interactive)=>{const payload={object:'whatsapp_business_account',entry:[{id:'fixture',changes:[{value:{metadata:{phone_number_id:pn},messages:[{id,from:onlyA,type:interactive?'interactive':'text',...(interactive?{interactive:{list_reply:{id:'academy:'+text,title:text}}}:{text:{body:text}})}]}}]}]};const raw=JSON.stringify(payload);return req('none','/webhook',{method:'POST',raw,headers:{'Content-Type':'application/json','x-hub-signature-256':'sha256='+createHmac('sha256','synthetic-webhook-only').update(raw).digest('hex')}});};
 await webhook('academy-main','hello');await sleep(40);check(calls().some(c=>c.name==='sendInteractive'&&c.args[2]===pn),'live engine selected correct Academy sender');
 await webhook('academy-handoff','human',true);await sleep(40);check(!s.getConversationBot(onlyA,pn),'actual webhook handoff disables conversation bot');
 const count=calls().length;await webhook('academy-after-handoff','hello');await sleep(40);check(calls().length===count,'no auto reply after actual handoff');
 console.log('PASS '+assertions+' Academy/quick-variable isolated assertions, '+evidence.length+' HTTP requests; provider replaced, no real sends.');
} catch(e){console.error(logs);throw e;} finally {child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));db.close();}
