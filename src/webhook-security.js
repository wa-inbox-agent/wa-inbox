import {createHmac,timingSafeEqual} from 'node:crypto';

// Meta signs the exact request bytes, not parsed/reserialized JSON.
export function validMetaSignature(raw,header,secret) {
  if(!secret||!Buffer.isBuffer(raw)||typeof header!=='string'||!/^sha256=[a-fA-F0-9]{64}$/.test(header))return false;
  const expected=createHmac('sha256',secret).update(raw).digest();
  const supplied=Buffer.from(header.slice(7),'hex');
  return supplied.length===expected.length&&timingSafeEqual(supplied,expected);
}
export function webhookSecurityStatus(env=process.env) {
  const configured=Boolean(env.META_APP_SECRET||env.APP_SECRET);
  const requested=env.WEBHOOK_SIGNATURE_ENFORCE==='1';
  return {app_secret_configured:configured,enforcement_requested:requested,signature_enforced:configured&&requested,
    ingress_ready:configured&&requested,number_registration:'admin_verified_numbers_only'};
}
export function metaWebhookGuard(req,res,next) {
  if(process.env.WEBHOOK_SIGNATURE_ENFORCE!=='1')return next();
  const secret=process.env.META_APP_SECRET||process.env.APP_SECRET;
  if(!secret)return res.status(503).json({error:'Webhook authentication is not configured'});
  if(!validMetaSignature(req.rawBody,req.get('x-hub-signature-256'),secret))return res.sendStatus(403);
  next();
}
