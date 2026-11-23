import assert from 'node:assert/strict';
import express from 'express';
import {createHmac} from 'node:crypto';
import {validMetaSignature,metaWebhookGuard,webhookSecurityStatus} from '../src/webhook-security.js';
let n=0,accepted=0;const check=(v,label)=>{assert.ok(v,label);n++;};
const secret='synthetic-meta-app-secret';
const raw=Buffer.from('{\n  "text": "مرحبا", "value": 1\n}\n','utf8');
const sign=b=>'sha256='+createHmac('sha256',secret).update(b).digest('hex');
check(validMetaSignature(raw,sign(raw),secret),'valid raw UTF-8 signature');
for(const [body,header,key] of [[raw,undefined,secret],[raw,'sha256=no',secret],[raw,'sha256='+'a'.repeat(63),secret],[raw,'sha1='+'a'.repeat(64),secret],[raw,sign(raw),'wrong-secret'],[Buffer.from(JSON.stringify(JSON.parse(raw))),sign(raw),secret],[Buffer.from(raw.toString().replace('1','2')),sign(raw),secret],[raw,sign(raw),''],[null,sign(raw),secret]])check(!validMetaSignature(body,header,key),'invalid/missing/raw-byte mismatch rejected');
const app=express();app.use(express.json({inflate:false,verify:(req,res,b)=>req.rawBody=Buffer.from(b)}));app.post('/webhook',metaWebhookGuard,(req,res)=>{accepted++;res.json({ok:true});});
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const url='http://127.0.0.1:'+server.address().port+'/webhook';
const request=async(body,signature)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(signature?{'X-Hub-Signature-256':signature}:{})},body});
const oldSecret=process.env.META_APP_SECRET,oldEnforce=process.env.WEBHOOK_SIGNATURE_ENFORCE,oldAlias=process.env.APP_SECRET;
try{
 delete process.env.APP_SECRET;process.env.META_APP_SECRET=secret;process.env.WEBHOOK_SIGNATURE_ENFORCE='1';
 check((await request(raw,sign(raw))).status===200,'HTTP valid exact bytes');
 check((await request(raw)).status===403,'HTTP missing signature');
 check((await request(raw,'sha256='+'0'.repeat(64))).status===403,'HTTP incorrect signature');
 check((await request(Buffer.from(JSON.stringify(JSON.parse(raw))),sign(raw))).status===403,'HTTP same JSON different bytes');
 check(accepted===1,'rejections do not reach processing handler');
 delete process.env.META_APP_SECRET;
 check((await request(raw,sign(raw))).status===503,'requested enforcement without secret fails closed');
 check(!webhookSecurityStatus().ingress_ready,'status does not falsely claim readiness');
 process.env.WEBHOOK_SIGNATURE_ENFORCE='0';
 check((await request(raw)).status===200,'explicit compatibility mode keeps existing ingress available');
 check(!webhookSecurityStatus().signature_enforced,'compatibility limitation explicit');
 process.env.APP_SECRET=secret;process.env.WEBHOOK_SIGNATURE_ENFORCE='1';
 check((await request(raw,sign(raw))).status===200,'APP_SECRET alias valid');
 check(webhookSecurityStatus().signature_enforced,'readiness requires both configured secret and explicit flag');
 console.log('PASS '+n+' webhook raw-byte/signature/HTTP assertions; synthetic secrets and loopback only.');
}finally{
 for(const [k,v] of [['META_APP_SECRET',oldSecret],['WEBHOOK_SIGNATURE_ENFORCE',oldEnforce],['APP_SECRET',oldAlias]])if(v===undefined)delete process.env[k];else process.env[k]=v;
 server.close();
}
