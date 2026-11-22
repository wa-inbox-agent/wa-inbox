(() => {
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const providerNames={salla:'سلة',zid:'زد',shopify:'Shopify'};
const statuses={abandoned:'سلة متروكة',observed:'بانتظار تأكيد الترك',converted:'أكمل الشراء',created:'طلب جديد · الدفع غير مؤكد',paid:'مدفوع',fulfilled:'تم تجهيز الطلب'};
let state=null,filter='all',tab='all';
async function api(url,body){const r=await fetch('/api/ecommerce'+url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'تعذر إتمام العملية');return d;}
function err(e){$('ecError').textContent=e.message||String(e);$('ecError').hidden=false;}
const resetErr=()=>{$('ecError').hidden=true;};
function connLabel(id){return state.connections.find(c=>c.id===id)?.label||'المتجر';}
function filtered(){return state.records.filter(r=>(filter==='all'||r.connection_id===filter)&&(tab==='all'||r.record_type===tab));}
function render(){
 const selectedWorkflowStore=$('ecWorkflowStore').value;
 const counts={cart:state.records.filter(r=>r.record_type==='cart').length,order:state.records.filter(r=>r.record_type==='order').length,converted:state.records.filter(r=>r.status==='converted').length};
 $('ecCounts').innerHTML=[['المتاجر المضافة',state.connections.length],['السلات',counts.cart],['الطلبات',counts.order],['أكملوا الشراء',counts.converted]].map(([l,n])=>`<div class="ec-stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
 $('ecStores').innerHTML=state.connections.length?state.connections.map(c=>`<article class="ec-store"><div class="ec-store-head"><b>${esc(c.label)}</b><span class="ec-pill">${providerNames[c.provider]}</span></div><div class="hint" dir="ltr">${esc(c.store_ref)}</div><p class="ec-status">${c.configured?'مهيأ للاستقبال الموثّق':'غير متصل'}</p><div class="hint">لم يُختبر على متجر فعلي · ${c.verified_events} أحداث موثّقة</div>${c.store_ref==='demo'?'<div class="ec-demo-label">بيانات تجريبية فقط</div>':`<details><summary>خطوات تهيئة الاستقبال</summary><p class="hint">${c.provider==='salla'?'أنشئ تطبيقًا في سلة، واضبط صلاحيات المتجر واشتراك الأحداث الموقّع.':c.provider==='zid'?'أنشئ تطبيق زد وصلاحيات الاشتراكات، مع Basic Auth مختلف لكل متجر. تحويل محتوى أحداث زد إلى سجلات ينتظر التحقق من نموذج متجر.':'اختر طريقة توزيع التطبيق وصلاحية قراءة الطلبات وبيانات العملاء. يجب التحقق من HMAC ونطاق المتجر. السلة الجديدة ليست دليلًا على تركها.'}</p><p class="hint">تحتاج تهيئة آمنة من مسؤول الاستضافة قبل استقبال أي حدث. لا تدخل مفاتيح الوصول أو كلمات السر هنا.</p><label>مسار استقبال هذا المتجر، أضف اسم الحدث في النهاية</label><code class="ec-code" dir="ltr">${esc(location.origin+c.webhook_path)}EVENT</code><div class="hint">الأحداث المدعومة: <span dir="ltr">${esc(c.topics.join(' · '))}</span></div></details>`}<button class="btn secondary ec-small" data-ec-delete="${c.id}">حذف البيانات المحلية</button></article>`).join(''):'<div class="ec-empty">لم تضف متجرًا بعد. أضف بياناته أو افتح مثالًا تجريبيًا أدناه. إضافة بيانات المتجر لا تربطه بمنصته.</div>';
 $('ecStoreFilter').innerHTML='<option value="all">كل المتاجر</option>'+state.connections.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('');$('ecStoreFilter').value=filter;
 const rows=filtered();
 $('ecRows').innerHTML=rows.length?rows.map(r=>`<tr><td><b>${esc(r.name||'بدون اسم')}</b><div class="hint">${esc(connLabel(r.connection_id))}</div>${r.synthetic?'<span class="ec-demo-label">تجريبي</span>':''}</td><td>${r.record_type==='cart'?'سلة':'طلب'}<div class="hint" dir="ltr">${esc(r.source_ref)}</div></td><td>${esc(statuses[r.status]||r.status)}</td><td>${esc(r.amount||'غير متاح')} ${esc(r.currency)}</td><td>${r.opted_out?'ألغى الاشتراك':r.consent?'موثقة':'غير موثقة'}<div class="hint" dir="ltr">${esc(r.phone||'لا يوجد رقم')}</div></td><td><button class="btn secondary ec-small" data-ec-preview="${r.id}">معاينة</button><button class="btn secondary ec-small" data-ec-consent="${r.id}">الموافقة</button></td></tr>`).join(''):'<tr><td colspan="6"><div class="ec-empty">لا توجد سجلات مطابقة. لن نعرض بيانات عملاء وهمية كأنها واردة من متجر.</div></td></tr>';
 $('ecWorkflowStore').innerHTML=state.connections.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('');if(state.connections.some(c=>c.id===selectedWorkflowStore))$('ecWorkflowStore').value=selectedWorkflowStore;$('ecWorkflowSave').disabled=!state.connections.length;loadWorkflow();
 $('ecEvents').innerHTML=state.events.length?state.events.map(e=>`<tr><td>${esc(connLabel(e.connection_id))}</td><td dir="ltr">${esc(e.topic)}</td><td>تم توثيق الطلب</td><td>${new Date(e.created_at).toLocaleString('ar-SA')}</td></tr>`).join(''):'<tr><td colspan="4" class="hint">لا توجد أحداث من متجر بعد. الأمثلة التجريبية لا تُحسب كأحداث موثّقة.</td></tr>';
}
function loadWorkflow(){if(!state)return;const id=$('ecWorkflowStore').value,w=$('ecWorkflowType').value;$('ecWorkflowBody').value=state.workflows.find(x=>x.connection_id===id&&x.workflow===w)?.body||state.defaults[w]||'';}
window.loadEcommerce=async()=>{resetErr();try{state=await api('');if(!state.connections.some(c=>c.id===filter))filter='all';render();}catch(e){err(e);}};
document.addEventListener('DOMContentLoaded',()=>{
 $('ecCreate').onsubmit=async e=>{e.preventDefault();resetErr();try{await api('/connections',{provider:$('ecProvider').value,label:$('ecLabel').value,store_ref:$('ecStoreRef').value});$('ecLabel').value='';$('ecStoreRef').value='';await window.loadEcommerce();}catch(e){err(e);}};
 $('ecReload').onclick=()=>window.loadEcommerce();
 $('ecStoreFilter').onchange=e=>{filter=e.target.value;render();};$('ecTypeFilter').onchange=e=>{tab=e.target.value;render();};
 document.querySelectorAll('[data-ec-demo]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await api('/demo',{provider:b.dataset.ecDemo});await window.loadEcommerce();}catch(e){err(e);}finally{b.disabled=false;}});
 $('ecStores').onclick=async e=>{const b=e.target.closest('[data-ec-delete]');if(!b)return;if(!confirm('حذف المتجر وسجلاته ونصوصه من هذا القسم؟ لا يحذف التطبيق أو الاشتراكات عند منصة المتجر.'))return;try{const r=await fetch('/api/ecommerce/connections/'+b.dataset.ecDelete,{method:'DELETE'});if(!r.ok)throw Error('تعذر حذف السجلات');await window.loadEcommerce();}catch(e){err(e);}};
 $('ecRows').onclick=async e=>{
  const preview=e.target.closest('[data-ec-preview]'),consent=e.target.closest('[data-ec-consent]');
  try{if(preview){const d=await api('/records/'+preview.dataset.ecPreview+'/preview');$('ecPreviewText').textContent=d.text;$('ecPreviewBlocks').innerHTML=d.blocks.map(x=>`<li>${esc(x)}</li>`).join('');$('ecPreview').hidden=false;$('ecPreview').scrollIntoView({block:'center',behavior:'smooth'});}
   if(consent){const r=state.records.find(r=>r.id===consent.dataset.ecConsent);$('ecConsentId').value=r.id;$('ecConsentYes').checked=!!r.consent;$('ecConsentOut').checked=!!r.opted_out;$('ecConsentNote').value=r.consent_note||'';$('ecConsentPanel').hidden=false;$('ecConsentPanel').scrollIntoView({block:'center',behavior:'smooth'});}
  }catch(e){err(e);}
 };
 $('ecConsentSave').onclick=async()=>{try{await api('/records/'+$('ecConsentId').value+'/consent',{consent:$('ecConsentYes').checked,opted_out:$('ecConsentOut').checked,note:$('ecConsentNote').value});$('ecConsentPanel').hidden=true;await window.loadEcommerce();}catch(e){err(e);}};
 $('ecConsentCancel').onclick=()=>{$('ecConsentPanel').hidden=true;};$('ecPreviewClose').onclick=()=>{$('ecPreview').hidden=true;};
 $('ecWorkflowStore').onchange=loadWorkflow;$('ecWorkflowType').onchange=loadWorkflow;
 $('ecWorkflowSave').onclick=async()=>{try{await api('/workflows',{connection_id:$('ecWorkflowStore').value,workflow:$('ecWorkflowType').value,body:$('ecWorkflowBody').value});$('ecSaved').textContent='تم حفظ نص المعاينة. الإرسال غير مفعّل.';await window.loadEcommerce();}catch(e){err(e);}};
});
})();
