/* Values are per-send only. This does not change or submit approved templates. */
(()=>{
let template,keys=[],inputs=[];
function setup(){
 const preview=document.getElementById('quickTplPreview');if(!preview)return null;
 let form=document.getElementById('quickVariables');
 if(!form){form=document.createElement('div');form.id='quickVariables';form.dir='rtl';form.style.cssText='display:grid;gap:12px;margin:16px 0';preview.after(form);}return form;
}
window.renderQuickVariables=t=>{
 template=t;const form=setup();if(!form)return;form.replaceChildren();inputs=[];
 const body=(t?.components||[]).find(c=>c.type==='BODY')?.text||'';
 keys=[...new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>+m[1]))].sort((a,b)=>a-b);
 if(!keys.length)return;
 const note=document.createElement('p');note.textContent='املأ كل قيمة بالترتيب. هذه القيم تُرسل نفسها لكل مستلم، ولا تعدّل القالب المعتمد. إضافة أو حذف متغير من النص تحتاج قالبًا جديدًا للمراجعة.';form.append(note);
 for(const n of keys){
  const label=document.createElement('label');label.style.cssText='display:grid;gap:6px';
  const context=body.split('\n').find(line=>line.includes('{{'+n+'}}'))||'';
  const title=document.createElement('span');title.textContent='قيمة المتغير '+n+' · '+context;
  const input=document.createElement('input');input.type='text';input.required=true;input.maxLength=1024;input.autocomplete='off';input.dataset.variable=String(n);input.placeholder='اكتب القيمة الفعلية، لا تتركها فارغة';input.oninput=update;
  label.append(title,input);form.append(label);inputs.push(input);
 }
 update();
};
function update(){
 const body=(template?.components||[]).find(c=>c.type==='BODY')?.text||'';
 const text=body.replace(/\{\{(\d+)\}\}/g,(_,n)=>inputs[keys.indexOf(+n)]?.value.trim()||'⟦قيمة '+n+' مطلوبة⟧');
 const preview=document.getElementById('quickTplPreview');preview.textContent=text;preview.style.whiteSpace='pre-wrap';
}
window.readQuickVariables=()=>{
 if((template?.components||[]).some(c=>c.type==='HEADER'&&/\{\{/.test(c.text||'')))throw Error('متغيرات الهيدر النصي غير مدعومة هنا، لا يمكن الإرسال من هذه الشاشة.');
 const raw=(template?.components||[]).find(c=>c.type==='BODY')?.text||'';
 if(/\{\{[^\d}]/.test(raw))throw Error('هذا القالب يستخدم متغيرات غير رقمية غير مدعومة هنا.');
 if(keys.some((n,i)=>n!==i+1))throw Error('ترقيم المتغيرات غير متصل. راجع القالب.');
 for(const input of inputs)if(!input.value.trim()){input.focus();throw Error('أكمل قيمة المتغير '+input.dataset.variable+' قبل الإرسال.');}
 return inputs.map(i=>i.value.trim());
};
})();
