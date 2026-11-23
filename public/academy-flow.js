export const ACADEMY_PN='1226967047176539';
export const VERSION='academy-20261123-v1';
export const CONTACT_URL='https://academy.jazancci.org.sa/Website/Contact';
export const CATALOG_URL='https://academy.jazancci.org.sa/Website/Courses';
export const HOME='أهلًا بك في أكاديمية غرفة جازان.\nاختر الخدمة التي تحتاجها من القائمة.\nللعودة في أي وقت اكتب «القائمة» أو 0.';
const normalize=s=>String(s??'').trim().replace(/[٠-٩]/g,x=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/[أإآ]/g,'ا');
const item=(id,label)=>({id,label});
function step(state={},input='',catalog=[]){
 const text=normalize(input),selected=String(input??'').trim();let node=state.node||'home';
 const main=()=>({state:{node:'home'},text:HOME,options:[item('courses','الدورات والبرامج'),item('diplomas','الدبلومات'),item('register','التسجيل والسداد'),item('certificate','الشهادات'),item('support','الدعم والاستفسارات'),item('contact','التواصل وساعات العمل'),item('rating','تقييم الخدمة'),item('human','التحدث مع موظف')]});
 if(['0','القائمة','القائمه','الرئيسية','الرئيسيه','البداية','البدايه','رجوع'].includes(text))return main();
 if(node==='handoff')return {state:{node:'handoff'},text:'المحادثة لدى الفريق. الرد الآلي متوقف؛ متابعة الموظف حسب التوفر.',options:[]};
 const home=main().options;let choice=selected;
 if(node==='home'){choice=home.find((o,i)=>o.id===selected||normalize(o.label)===text||String(i+1)===text)?.id||selected;
 if(/موظف|انسان|بشري/.test(text))choice='human';else if(/تقييم/.test(text))choice='rating';else if(/دفع|سداد|اشتراك|تسجيل|رسوم|سعر/.test(text))choice='register';else if(/شهاد/.test(text))choice='certificate';else if(/دبلوم/.test(text))choice='diplomas';else if(/دور|برنامج/.test(text))choice='courses';}
 if(node==='rating'){
  const rating=Number((/^rating_[1-5]$/.test(selected)?selected.slice(-1):text));
  if(Number.isInteger(rating)&&rating>=1&&rating<=5)return {state:{node:'home'},rating,text:'شكرًا لتقييمك '+rating+' من 5. رأيك يساعد أكاديمية غرفة جازان على تحسين الخدمة.',options:[item('home','القائمة الرئيسية')]};
 }
 if(choice==='home')return main();
 if(choice==='human')return {state:{node:'handoff'},handoff:true,text:'تم إيقاف الرد الآلي لهذه المحادثة ليتمكن فريق الأكاديمية من متابعتها. اكتب استفسارك هنا، وستكون المتابعة حسب توفر الفريق.\nللتواصل: 0500205353\n'+CONTACT_URL,options:[]};
 if(choice==='rating'||node==='rating')return {state:{node:'rating'},text:'كيف تقيّم تجربتك مع خدمة أكاديمية غرفة جازان؟\nاختر من 1 (غير راضٍ) إلى 5 (راضٍ جدًا).',options:[1,2,3,4,5].map(n=>item('rating_'+n,n+' من 5'))};
 const back=[item('home','القائمة الرئيسية'),item('human','التحدث مع موظف')];
 if(['courses','diplomas'].includes(choice)||/^catalog_/.test(node)){
  const kind=['courses','diplomas'].includes(choice)?choice:node.split('_')[1];const page=/^page_\d+$/.test(choice)?Number(choice.slice(5)):0;
  if(/^course_\d+$/.test(choice)){}else{
   const rows=catalog.filter(c=>c.open&&(kind==='diplomas'?c.diploma:!c.diploma));const part=rows.slice(page*7,page*7+7);
   return {state:{node:'catalog_'+kind},text:(kind==='diplomas'?'الدبلومات':'الدورات والبرامج')+' التي ظهر التسجيل فيها متاحًا عند مراجعة 23 نوفمبر 2026.\nالتوفر والرسوم قد يتغيران. التفاصيل النهائية لدى الأكاديمية.\n'+CATALOG_URL,options:[...part.map(c=>item('course_'+c.id,c.title)),...(rows.length>(page+1)*7?[item('page_'+(page+1),'المزيد')]:[]),...back]};
  }
 }
 if(/^course_\d+$/.test(choice)){const c=catalog.find(x=>'course_'+x.id===choice&&x.open);if(c)return {state:{node:'home'},text:c.title+'\nحالة التسجيل عند مراجعة 23 نوفمبر 2026: متاح في صفحة البرنامج.\nراجع التفاصيل والتوفر الحالي هنا:\n'+c.url+'\nالاشتراك والسداد عبر خدمة العملاء: 0500205353. لا يتم تحصيل مدفوعات هنا.',options:[item('register','التسجيل والسداد'),...back]};}
 const copy={register:'للتسجيل: اختر برنامجك من موقع الأكاديمية، ثم تواصل مع خدمة العملاء لتأكيد الإجراءات والاشتراك والسداد.\nلا نطلب بيانات بطاقات أو نحصل مدفوعات في هذه المحادثة.\n0500205353\n'+CATALOG_URL,certificate:'للاستفسار عن شهادة، تواصل مع فريق الأكاديمية واذكر اسم البرنامج وتاريخ حضورك. لا ترسل بيانات حساسة.\nالتأكد من استحقاق الشهادة وموعد إصدارها يكون لدى الفريق، ولا نعد بمدة إصدار ثابتة.\n'+CONTACT_URL,support:'للدعم أو الاستفسار، اختر التحدث مع موظف ثم اكتب ملخصًا للمشكلة واسم البرنامج إن وجد، دون كلمات مرور أو بيانات بطاقات.\n'+CONTACT_URL,contact:'خدمة عملاء أكاديمية غرفة جازان: 0500205353\nساعات العمل المنشورة: الأحد إلى الخميس، 8:00 صباحًا إلى 2:30 مساءً بتوقيت السعودية.\nالمرجع الرسمي وأحدث التفاصيل:\n'+CONTACT_URL};
 if(copy[choice])return {state:{node:'home'},text:copy[choice],options:back};
 return main();
}

export function academyStep(state={},input='',catalog=[]){
 let value=String(input??'').trim();const norm=normalize(value);
 if(!['0','القائمة','القائمه','رجوع'].includes(norm)){
  const opts=state.options||[];const o=opts.find((o,i)=>o.id===value||normalize(o.label)===norm||String(i+1)===norm);if(o)value=o.id;
 }
 const out=step(state,value,catalog);out.state.options=out.options;return out;
}
