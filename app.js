(() => {
  'use strict';
  const cfg = window.AN_CONFIG || {};
  const db = (window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;
  const $ = id => document.getElementById(id);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => iso(new Date());
  const monthNames = ['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];
  const dayNames = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = '';

  function message(text, type='') { const el=$('booking-message'); if(!el)return; el.textContent=text; el.className='form-message wide '+type; }
  function publicUrl(path) { return db.storage.from('andreea-nails').getPublicUrl(path).data.publicUrl; }

  async function loadServices() {
    const {data,error}=await db.from('site_services').select('*').eq('active',true).order('sort_order',{ascending:true});
    if(error){$('service-list').innerHTML='<p class="form-message error">Serviciile nu au putut fi încărcate.</p>';return;}
    const list=$('service-list'), select=$('service-select'); list.innerHTML=''; select.innerHTML='<option value="">Alege serviciul</option>';
    (data||[]).forEach((s,i)=>{
      const a=document.createElement('article');a.className='service';
      const n=document.createElement('span');n.className='service-number';n.textContent=String(i+1).padStart(2,'0');
      const h=document.createElement('h3');h.textContent=s.name||'';
      const p=document.createElement('p');p.textContent=s.description||'';
      const strong=document.createElement('strong');strong.textContent=s.price||'';
      a.append(n,h,p,strong);list.appendChild(a);
      const o=document.createElement('option');o.value=s.name;o.textContent=s.name;select.appendChild(o);
    });
    if(!data?.length) list.innerHTML='<p class="muted">Momentan nu sunt servicii publicate.</p>';
  }

  async function loadGallery() {
    const {data,error}=await db.from('site_gallery').select('*').order('sort_order',{ascending:true});
    const host=$('gallery-list');host.innerHTML='';
    if(error){host.innerHTML='<p class="form-message error">Galeria nu a putut fi încărcată.</p>';return;}
    (data||[]).forEach(g=>{
      const fig=document.createElement('figure');fig.className='gallery-item';
      const img=document.createElement('img');img.src=publicUrl(g.image_path);img.alt=g.caption||'Lucrare Andreea Nails';img.loading='lazy';
      fig.appendChild(img);if(g.caption){const cap=document.createElement('figcaption');cap.textContent=g.caption;fig.appendChild(cap);}host.appendChild(fig);
    });
    if(!data?.length) host.innerHTML='<p class="muted">Galeria va fi completată în curând.</p>';
  }

  function applyCustomization(c={}) {
    document.body.dataset.theme=c.theme||'classic';
    document.body.classList.toggle('no-decorations',c.decorations===false);
    const root=document.documentElement;
    [['primary','primary_color'],['accent','accent_color'],['bg','background_color'],['text','text_color']].forEach(([css,key])=>{if(c[key])root.style.setProperty('--'+css,c[key]);});
    const ids={hero_title:'hero-title',hero_description:'hero-description',hero_quote:'hero-quote',booking_title:'booking-title',booking_description:'booking-description',services_title:'services-title',services_description:'services-description',gallery_title:'gallery-title',gallery_description:'gallery-description',contact_title:'contact-title',contact_note:'contact-note',hero_eyebrow:'hero-eyebrow',hero_button:'hero-button',hero_note:'hero-note'};
    Object.entries(ids).forEach(([key,id])=>{if(c[key]!==undefined && $(id)) $(id).textContent=c[key];});
    if(c.instagram) setSocialLink('instagram-link',c.instagram,'https://instagram.com/');
    if(c.facebook) setSocialLink('facebook-link',c.facebook,'https://facebook.com/');
    if(c.font_family){
      const safe=['DM Sans','Montserrat','Poppins','Lora','Cormorant Garamond','Playfair Display'];
      const ff=safe.includes(c.font_family)?c.font_family:'DM Sans';
      root.style.setProperty('--font',`'${ff}',sans-serif`);
      root.style.setProperty('--font-heading',`'${ff}',serif`);
      if(!document.querySelector('[data-site-font]')){const l=document.createElement('link');l.dataset.siteFont='1';l.rel='stylesheet';l.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(ff).replace(/%20/g,'+')+':wght@400;500;600;700&display=swap';document.head.appendChild(l);}
    }
    if(c.background_image){document.body.classList.add('custom-bg');document.body.style.backgroundImage=`url("${String(c.background_image).replace(/["\\]/g,'')}")`;}
    if(c.decorative_text) document.body.style.setProperty('--decorative-text',`"${String(c.decorative_text).replace(/["\\]/g,'')}"`);
  }
  function setSocialLink(id,value,prefix){const el=$(id);if(!el)return;const v=String(value||'').trim();el.href=/^https?:\/\//i.test(v)?v:prefix+v.replace(/^@/,'');el.textContent=v||prefix.replace('https://','').replace('/','');}

  async function loadCustomizationAndSettings(){
    const [{data:settings},{data:custom}]=await Promise.all([
      db.from('site_settings').select('*').eq('id',1).maybeSingle(),
      db.from('site_customization').select('settings').eq('id',1).maybeSingle()
    ]);
    if(settings){setSocialLink('instagram-link',settings.instagram,'https://instagram.com/');setSocialLink('facebook-link',settings.facebook,'https://facebook.com/');if(settings.contact_note && !$('contact-note').dataset.customized)$('contact-note').textContent=settings.contact_note;}
    applyCustomization(custom?.settings||{});
  }

  function renderSlots(list){
    const host=$('slots');host.innerHTML='';$('booking-time').value='';
    if(!list.length){host.innerHTML='<p class="muted">Nu mai sunt ore disponibile în această zi.</p>';return;}
    list.forEach(raw=>{const time=String(raw).slice(0,5),b=document.createElement('button');b.type='button';b.className='slot';b.textContent=time;b.onclick=()=>{host.querySelectorAll('.slot').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');$('booking-time').value=time;message('Ai ales ora '+time+'. Poți trimite solicitarea.','success');};host.appendChild(b);});
  }

  async function loadSlots(date){
    if(!db)return;
    $('slots').innerHTML='<p class="muted">Se verifică orele disponibile...</p>';
    const [{data:slots,error},{data:blocked,error:blockError}]=await Promise.all([
      db.rpc('get_available_slots',{p_date:date}),
      db.from('blocked_dates').select('booking_date').eq('booking_date',date).maybeSingle()
    ]);
    if(error||blockError){$('slots').innerHTML='<p class="form-message error">Nu am putut verifica orele. Calendarul trebuie configurat în Supabase.</p>';return;}
    if(blocked){$('slots').innerHTML='<p class="muted">Această zi este indisponibilă.</p>';return;}
    renderSlots((slots||[]).map(x=>x.booking_time));
  }

  async function renderCalendar(){
    const host=$('booking-calendar');if(!host||!db)return;
    $('calendar-month').textContent=`${monthNames[month.getMonth()]} ${month.getFullYear()}`;
    host.innerHTML='<p class="muted">Se încarcă disponibilitatea...</p>';
    const start=iso(new Date(month.getFullYear(),month.getMonth(),1));const end=iso(new Date(month.getFullYear(),month.getMonth()+1,0));
    const {data,error}=await db.rpc('get_month_availability',{p_start:start,p_end:end});
    if(error){host.innerHTML='<p class="form-message error">Calendarul nu este configurat încă.</p>';return;}
    const map={};(data||[]).forEach(x=>map[String(x.booking_date).slice(0,10)]=Number(x.available_count));
    dayNames.forEach(n=>{const e=document.createElement('span');e.className='calendar-weekday';e.textContent=n;host.appendChild(e);});
    const first=new Date(month.getFullYear(),month.getMonth(),1),offset=(first.getDay()+6)%7;
    for(let i=0;i<offset;i++){const e=document.createElement('span');e.className='calendar-day empty';host.appendChild(e);}
    const days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    for(let n=1;n<=days;n++){
      const d=new Date(month.getFullYear(),month.getMonth(),n),key=iso(d),available=key>=today()&&map[key]>0;
      const b=document.createElement('button');b.type='button';b.className='calendar-day '+(available?'available':'unavailable');
      const num=document.createElement('span');num.className='day-number';num.textContent=n;b.appendChild(num);
      const st=document.createElement('small');st.textContent=available?'Disponibil':'Indisponibil';b.appendChild(st);
      if(!available)b.disabled=true;
      else b.onclick=()=>{selectedDate=key;$('booking-date').value=key;host.querySelectorAll('.calendar-day').forEach(x=>x.classList.remove('chosen'));b.classList.add('chosen');$('slots').innerHTML='<p class="muted">Se verifică orele disponibile...</p>';loadSlots(key);message(`Ai ales ${d.toLocaleDateString('ro-RO')}. Alege o oră disponibilă.`);};
      host.appendChild(b);
    }
  }

  async function submitBooking(e){
    e.preventDefault();
    const form=e.currentTarget;if(!db){message('Site-ul nu este conectat la Supabase.','error');return;}
    if(!form.reportValidity())return;
    if(!$('booking-date').value||!$('booking-time').value){message('Alege mai întâi o zi și o oră.','error');return;}
    const fd=new FormData(form), payload={client_name:String(fd.get('client_name')).trim(),phone:null,social_platform:String(fd.get('social_platform')),social_username:String(fd.get('social_username')).trim(),email:String(fd.get('email')).trim().toLowerCase(),service:String(fd.get('service')),booking_date:String(fd.get('booking_date')),booking_time:String(fd.get('booking_time')),notes:String(fd.get('notes')||'').trim()||null,status:'pending'};
    const btn=$('submit-booking');btn.disabled=true;btn.textContent='Se trimite...';
    const {error}=await db.from('bookings').insert(payload);
    btn.disabled=false;btn.innerHTML='Trimite solicitarea <span>↗</span>';
    if(error){message(/SLOT_NOT_AVAILABLE|duplicate|unique/i.test(error.message)?'Această oră nu mai este disponibilă. Alege alta.':'Nu am putut trimite programarea: '+error.message,'error');await renderCalendar();if(selectedDate)await loadSlots(selectedDate);return;}
    try{const r=await db.functions.invoke(cfg.EDGE_FUNCTION_NAME||'quik-worker',{body:{action:'new',booking:payload}});if(r.error)console.warn('Email notification failed',r.error);}catch(err){console.warn('Email notification failed',err);}
    form.reset();selectedDate='';$('booking-date').value='';$('booking-time').value='';$('slots').innerHTML='<p class="muted">Alege o zi din calendar.</p>';
    message('Solicitarea a fost trimisă cu succes. Vei fi contactată pentru confirmare.','success');await renderCalendar();
  }

  async function init(){
    $('year').textContent=new Date().getFullYear();
    if(!db){message('Configurația Supabase lipsește.','error');return;}
    $('calendar-prev').onclick=()=>{const min=new Date(new Date().getFullYear(),new Date().getMonth(),1);const next=new Date(month.getFullYear(),month.getMonth()-1,1);if(next>=min){month=next;renderCalendar();}};
    $('calendar-next').onclick=()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();};
    $('booking-form').addEventListener('submit',submitBooking);
    await Promise.all([loadServices(),loadGallery(),loadCustomizationAndSettings(),renderCalendar()]);
  }
  init().catch(err=>{console.error(err);const host=$('booking-calendar');if(host)host.innerHTML='<p class="form-message error">A apărut o eroare la încărcarea site-ului. Verifică configurația Supabase.</p>';});
})();
