(() => {
 const ar=()=>document.documentElement.dir!=='ltr';
 const header=document.querySelector('body>header');if(!header)return;
 const nav=header.querySelector('nav'),foot=header.querySelector('.side-foot');
 const wrap=document.createElement('div');wrap.className='ux-sidebar-content';wrap.id='uxNavigation';header.append(wrap);wrap.append(nav,foot);
 nav.setAttribute('aria-label',ar()?'التنقل الرئيسي':'Main navigation');
 const menu=document.createElement('button');menu.id='uxMenu';menu.type='button';menu.setAttribute('aria-controls','uxNavigation');menu.setAttribute('aria-expanded','false');menu.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span></span>';header.append(menu);
 const shade=document.createElement('button');shade.type='button';shade.className='ux-backdrop';shade.tabIndex=-1;document.body.append(shade);
 const mql=matchMedia('(max-width:860px)');
 function sync(open=false,restore=false){document.body.classList.toggle('ux-nav-open',open&&mql.matches);menu.setAttribute('aria-expanded',String(open&&mql.matches));menu.querySelector('span').textContent=ar()?(open?'إغلاق':'القائمة'):(open?'Close':'Menu');shade.setAttribute('aria-label',ar()?'إغلاق القائمة':'Close menu');wrap.inert=mql.matches&&!open;if(restore)menu.focus();}
 menu.onclick=()=>{const open=!document.body.classList.contains('ux-nav-open');sync(open);if(open)nav.querySelector('button:not([hidden])')?.focus();};shade.onclick=()=>sync(false,true);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('ux-nav-open'))sync(false,true);if(e.key==='Tab'&&mql.matches&&document.body.classList.contains('ux-nav-open')){const list=[menu,...wrap.querySelectorAll('button:not([hidden]),a[href]')].filter(x=>x.offsetParent!==null&&!x.disabled);const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
 mql.addEventListener('change',()=>sync());nav.addEventListener('click',e=>{if(e.target.closest('[data-view]')&&mql.matches){sync();document.querySelector('.view.active h2,.view.active #convoSearch')?.focus();}});
 const skip=document.createElement('a');skip.id='uxSkip';skip.href='#view-dashboard';skip.textContent=ar()?'انتقل للمحتوى':'Skip to content';skip.onclick=e=>{e.preventDefault();const target=document.querySelector('.view.active h2,.view.active input');if(target){target.tabIndex=-1;target.focus();}};document.body.prepend(skip);
 const copy=document.body.dataset.product==='sale'?{ar:['مساحة أعمالك، أوضح.','من الرسالة الأولى إلى المتابعة، أدواتك في مساحة عمل مرتّبة.','محادثات منظّمة','حملات حسب احتياج نشاطك','إعداد مستقل لهوية مشروعك'],en:['Your workspace, clearer.','From the first message to follow-up, keep your tools in one organised workspace.','Organised conversations','Campaigns for your business','Your own business identity']}:{ar:['تواصل يليق بالغرفة.','مساحة واحدة لفريقك، بتنظيم واضح لكل رقم وقسم.','صندوق وارد لكل قسم','أدوات للحملات وخدمة المستفيدين','أكاديمية الغرفة · نمو · الغرفة'],en:['Built around your team.','One workspace, with clear organisation for each number and department.','An inbox for each department','Campaign and customer-service tools','Academy · Nomow · Chamber']};
 const overlay=document.getElementById('loginOverlay');const story=document.createElement('section');story.className='ux-login-story';story.setAttribute('aria-hidden','true');overlay?.prepend(story);
 function labels(){const c=copy[ar()?'ar':'en'];story.replaceChildren();for(const [tag,text,cls]of [['span',ar()?'منصة واتساب للأعمال':'WhatsApp workspace','ux-story-kicker'],['h2',c[0],''],['p',c[1],'']]){const el=document.createElement(tag);el.textContent=text;el.className=cls;story.append(el);}const lines=document.createElement('div');lines.className='ux-story-lines';c.slice(2).forEach((text,i)=>{const l=document.createElement('div');l.className='ux-story-line';const n=document.createElement('span');n.textContent='0'+(i+1);l.append(n,document.createTextNode(text));lines.append(l);});story.append(lines);sync();}
 let scheduled=false;function enhance(){scheduled=false;
 document.querySelectorAll('.page>h2').forEach(h=>{h.tabIndex=-1;if(!h.querySelector('.ux-kicker')){const k=document.createElement('span');k.className='ux-kicker';k.textContent=ar()?'مساحة العمل':'Workspace';h.prepend(k);}});
 document.querySelectorAll('label:not([for])').forEach(l=>{if(l.querySelector('input,select,textarea'))return;const el=l.nextElementSibling;if(el?.id&&/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName))l.htmlFor=el.id;});
 document.querySelectorAll('table').forEach(t=>{const heads=[...t.querySelectorAll('thead th')].map(h=>h.textContent.trim());if(!heads.length)return;t.classList.add('ux-data-table');t.querySelectorAll('tbody tr').forEach(tr=>{[...tr.children].forEach((td,i)=>{if(td.colSpan<=1&&td.dataset.label!==heads[i])td.dataset.label=heads[i]||'';});});});
 document.querySelectorAll('.err,.ec-error').forEach(e=>{e.setAttribute('role','alert');});
 document.querySelectorAll('nav [data-view]').forEach(b=>b.setAttribute('aria-current',b.classList.contains('active')?'page':'false'));
 const names={convoSearch:['بحث في المحادثات','Search conversations'],msgInput:['نص الرسالة','Message text'],ecStoreFilter:['تصفية المتجر','Filter store'],ecTypeFilter:['تصفية نوع السجل','Filter record type']};for(const [id,l]of Object.entries(names)){document.getElementById(id)?.setAttribute('aria-label',l[ar()?0:1]);}
 }
 new MutationObserver(()=>{if(!scheduled){scheduled=true;requestAnimationFrame(enhance);}}).observe(document.body,{childList:true,subtree:true});
 new MutationObserver(labels).observe(document.documentElement,{attributes:true,attributeFilter:['dir']});
 labels();enhance();

 const icons={attachBtn:['M21 11.5 12 20a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.5 5.5l-9.5 9.5a2 2 0 0 1-3-3l9-9','إرفاق ملف','Attach file'],micBtn:['M12 15a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v7a3 3 0 0 0 3 3ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8','تسجيل رسالة صوتية','Record voice message'],chatSearchBtn:['M21 21l-6-6M17 9a7 7 0 1 1-14 0 7 7 0 0 1 14 0','بحث في المحادثة','Search chat'],labelsBtn:['M3 3h7l11 11-7 7L3 10V3ZM7 7h.01','تصنيفات المحادثة','Conversation labels']};
 for(const [id,[path,aa,en]]of Object.entries(icons)){const el=document.getElementById(id);if(!el)continue;el.setAttribute('aria-label',ar()?aa:en);el.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="'+path+'"/></svg>';}

})();

/* Academy typography helper: display only; no API, value, or configuration writes. */
(() => {
 let pending=false;const counters=new WeakMap();
 const eligible='textarea:not([data-typography-skip])';
 function grow(e){
  if(e.offsetParent===null)return;
  const focused=document.activeElement===e;
  if(focused)return; // Never move the caret or resize beneath an active editor.
  e.style.height='auto';
  const cap=matchMedia('(max-width:860px)').matches?420:560;
  e.style.height=Math.min(cap,Math.max(155,e.scrollHeight+3))+'px';
 }
 function apply(){
  pending=false;
  document.querySelectorAll(eligible).forEach(e=>{
   if(!e.classList.contains('ux-copy-editor'))e.classList.add('ux-copy-editor');
   if(!e.hasAttribute('dir')&&!e.id.toLowerCase().includes('json'))e.dir='auto';
   if(e.dataset.typographyBound){counters.get(e)?.();return;}
   e.dataset.typographyBound='true';
   const inBot=!!e.closest('#view-bot');
   let count;
   if(inBot){
    const caption=document.createElement('div');caption.className='ux-copy-caption';caption.dataset.for=e.id;
    const hint=document.createElement('span');hint.textContent=document.documentElement.lang==='en'?'Line breaks are preserved in the reply.':'يُحفظ الرد بنفس ترتيب الأسطر.';
    count=document.createElement('span');caption.append(hint,count);e.after(caption);
   }
   const update=()=>{if(!count)return;const text=e.value.length.toLocaleString(document.documentElement.lang==='en'?'en':'ar-SA')+(document.documentElement.lang==='en'?' characters':' حرف');if(count.textContent!==text)count.textContent=text;};
   counters.set(e,update);e.addEventListener('input',update);e.addEventListener('blur',()=>{grow(e);update();});
   e.addEventListener('focus',update);update();grow(e);
  });
  document.querySelectorAll('textarea.ux-copy-editor').forEach(grow);
 }
 const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(apply);}};
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
 document.addEventListener('click',e=>{if(e.target.closest('[data-view]'))requestAnimationFrame(()=>requestAnimationFrame(apply));});
 window.addEventListener('resize',schedule);
 // Existing loaders assign textarea.value without a DOM mutation. These bounded
 // passes catch initial asynchronous loads without polling or touching state.
 requestAnimationFrame(apply);setTimeout(apply,450);setTimeout(apply,1400);
})();
