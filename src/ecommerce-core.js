// Preparation library only. No network client, merchant credentials or send transport.
import {createHmac,timingSafeEqual} from 'node:crypto';
const safeEqual=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
function needed(value){return typeof value==='string'&&value.length>0;}
export function verifyWebhook({provider,rawBody,headers,credentials}){
  if(!Buffer.isBuffer(rawBody)||!credentials)return false;
  const h=Object.fromEntries(Object.entries(headers??{}).map(([k,v])=>[k.toLowerCase(),v]));
  if(provider==='salla'){
    if(!needed(credentials.secret)||h['x-salla-security-strategy']!=='Signature')return false;
    const sig=h['x-salla-signature'];
    return typeof sig==='string'&&/^[0-9a-f]{64}$/i.test(sig)&&safeEqual(sig.toLowerCase(),createHmac('sha256',credentials.secret).update(rawBody).digest('hex'));
  }
  if(provider==='shopify'){
    if(!needed(credentials.secret))return false;
    const sig=h['x-shopify-hmac-sha256'];
    return typeof sig==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(sig)&&safeEqual(sig,createHmac('sha256',credentials.secret).update(rawBody).digest('base64'));
  }
  if(provider==='zid'){
    if(!needed(credentials.username)||!needed(credentials.password))return false;
    const expected='Basic '+Buffer.from(credentials.username+':'+credentials.password).toString('base64');
    return typeof h.authorization==='string'&&safeEqual(h.authorization,expected);
  }
  return false;
}
const topics={
  salla:{'abandoned.cart':'abandoned','abandoned.cart.updated':'abandoned','abandoned.cart.status.changed':'cart-status','order.created':'order-created','order.status.updated':'order-status','order.payment.updated':'payment-status'},
  zid:{'abandoned_cart.created':'abandoned','abandoned_cart.completed':'converted','order.create':'order-created','order.status.update':'order-status','order.payment_status.update':'payment-status'},
  shopify:{'carts/create':'cart-observed','carts/update':'cart-observed','checkouts/create':'checkout-observed','checkouts/update':'checkout-observed','orders/create':'order-created','orders/paid':'paid','orders/fulfilled':'fulfilled'}
};
export const classifyEvent=(provider,topic)=>topics[provider]?.[topic]??null;
export function previewDecision({kind,phone,whatsappOptIn=false,optedOut=false,converted=false,templateApproved=false,hasRecoveryUrl=false,abandonmentConfirmed=false}){
  if(optedOut)return {eligible:false,reason:'opted-out'};
  if(!phone)return {eligible:false,reason:'no-phone'};
  if(!whatsappOptIn)return {eligible:false,reason:'no-whatsapp-opt-in'};
  if(!templateApproved)return {eligible:false,reason:'template-not-approved'};
  if(['cart-observed','checkout-observed','abandoned'].includes(kind)){
    if(converted)return {eligible:false,reason:'converted'};
    if(!abandonmentConfirmed)return {eligible:false,reason:'abandonment-unconfirmed'};
    if(!hasRecoveryUrl)return {eligible:false,reason:'no-recovery-url'};
    return {eligible:true,previewOnly:true,workflow:'cart-recovery'};
  }
  if(kind==='paid'||kind==='fulfilled')return {eligible:true,previewOnly:true,workflow:kind};
  return {eligible:false,reason:'needs-provider-status-mapping'};
}
