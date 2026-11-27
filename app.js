(() => {
  const cfg = window.AN_CONFIG || {};
  const ready = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY;
  const db = ready ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY) : null;
  const $ = id => document.getElementById(id);
  const form = $('booking-form'), slots = $('slots'), timeInput = $('booking-time'), msg = $('booking-message');
  const dateInput = $('booking-date');
  const dayNames = ['Lu','Ma','Mi','Jo','Vi','Sâ','Du'];
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let monthAvailability = {};
  $('year').textContent = new Date().getFullYear();
  dateInput.min = iso(new Date());
  const say = (t,c='') => { msg.textContent=t; msg.className='form-message wide '+c; };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const today = () => iso(new Date());

  function renderSlots(list=[], blocked=false) {
    slots.innerHTML=''; timeInput.value='';
    if (blocked || !list.length) { slots.textContent = blocked ? 'Această zi este indisponibilă.' : 'Nu mai sunt ore disponibile în această zi.'; return; }
    list.forEach(t => {
      const value=String(t).slice(0,5), b=document.createElement('button');
      b.type='button'; b.className='slot'; b.textContent=value;
      b.onclick=()=>{ slots.querySelectorAll('.slot').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); timeInput.value=value; };
      slots.appendChild(b);
    });
  }

  async function loadSlots(date) {
    if (!db || !date) return;
    slots.textContent='Se verifică orele disponibile...'; timeInput.value='';
    const [{data:available,error}, {data:blocked,error:blockError}] = await Promise.all([
      db.rpc('get_available_slots',{p_date:date}),
      db.from('blocked_dates').select('booking_date').eq('booking_date',date).maybeSingle()
    ]);
    if (error || blockError) { slots.textContent='Nu am putut verifica disponibilitatea.'; say('Verifică dacă a fost aplicată actualizarea bazei de date. '+(error?.message||blockError?.message||''),'error'); return; }
    renderSlots((available||[]).map(x=>x.booking_time),!!blocked);
  }

  async function renderCalendar() {
    const host=$('booking-calendar'); if (!host || !db) return;
    const start=new Date(month.getFullYear(),month.getMonth(),1), end=new Date(month.getFullYear(),month.getMonth()+1,0);
    $('calendar-month').textContent=month.toLocaleDateString('ro-RO',{month:'long',year:'numeric'});
    const {data,error}=await db.rpc('get_month_availability',{p_start:iso(start),p_end:iso(end)});
    if(error){host.innerHTML='<p class="form-message error">Calendarul nu este configurat încă. Te rugăm să revii mai târziu.</p>';return;}
    monthAvailability={}; (data||[]).forEach(x=>monthAvailability[String(x.booking_date).slice(0,10)]=Number(x.available_count));
    host.innerHTML='';
    dayNames.forEach(n=>{const el=document.createElement('span');el.className='calendar-weekday';el.textContent=n;host.appendChild(el);});
    const offset=(start.getDay()+6)%7;
    for(let i=0;i<offset;i++){const blank=document.createElement('span');blank.className='calendar-day empty';host.appendChild(blank);}
    for(let n=1;n<=end.getDate();n++){
      const d=new Date(month.getFullYear(),month.getMonth(),n), key=iso(d), count=monthAvailability[key]||0;
      const b=document.createElement('button');b.type='button';b.className='calendar-day';const num=document.createElement('span');num.className='day-number';num.textContent=n;b.appendChild(num);const status=document.createElement('small');status.textContent=(key<today()||count===0)?'Indisponibil':'Disponibil';b.appendChild(status);
      if(key<today()||count===0){b.disabled=true;b.classList.add('unavailable');}
      else {b.classList.add('available');b.setAttribute('aria-label',d.toLocaleDateString('ro-RO')+' disponibil');b.onclick=()=>{host.querySelectorAll('.calendar-day').forEach(x=>x.classList.remove('chosen'));b.classList.add('chosen');dateInput.value=key;loadSlots(key);say('Ai ales '+d.toLocaleDateString('ro-RO')+'. Alege o oră disponibilă.');};}
      host.appendChild(b);
    }
  }

  $('calendar-prev').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar();});
  $('calendar-next').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar();});

  async function loadContent(){
    if(!db)return;
    const [{data:services},{data:settings},{data:gallery}] = await Promise.all([
      db.from('site_services').select('*').eq('active',true).order('sort_order'),
      db.from('site_settings').select('*').eq('id',1).maybeSingle(),
      db.from('site_gallery').select('*').order('sort_order')
    ]);
    $('service-list').innerHTML=''; $('service-select').innerHTML='<option value="">Alege serviciul</option>';
    (services||[]).forEach((s,i)=>{
      const a=document.createElement('article');a.className='service';
      [String(i+1).padStart(2,'0'),s.name,s.description,s.price].forEach((v,j)=>{const e=document.createElement(j===0?'span':j===1?'h3':j===2?'p':'strong');e.textContent=v||'';if(j===0)e.className='service-number';a.appendChild(e);});
      $('service-list').appendChild(a);const o=document.createElement('option');o.value=s.name;o.textContent=s.name;$('service-select').appendChild(o);
    });
    if(settings){$('contact-note').textContent=settings.contact_note||'Pentru întrebări despre programări, mă poți contacta direct.';[['instagram-link',settings.instagram],['facebook-link',settings.facebook]].forEach(([id,url])=>{if(url){$(id).href=/^https?:\/\//i.test(url)?url:(id==='instagram-link'?'https://instagram.com/':'https://facebook.com/')+url.replace(/^@/,'');}});}
    const {data:custom}=await db.from('site_customization').select('settings').eq('id',1).maybeSingle(); if(custom?.settings){const c=custom.settings;const root=document.documentElement;document.body.dataset.theme=c.theme||'classic';if(c.hero_title)$('hero-title').textContent=c.hero_title;if(c.hero_description)$('hero-description').textContent=c.hero_description;if(c.hero_quote)$('hero-quote').textContent=c.hero_quote;if(c.booking_title)$('booking-title').textContent=c.booking_title;if(c.booking_description)$('booking-description').textContent=c.booking_description;if(c.decorations===false)document.body.classList.add('no-decorations');if(c.primary_color)root.style.setProperty('--custom-primary',c.primary_color);if(c.accent_color)root.style.setProperty('--custom-accent',c.accent_color);if(c.background_color)root.style.setProperty('--custom-background',c.background_color);if(c.text_color)root.style.setProperty('--custom-text',c.text_color);if(c.font_family){const safe=['DM Sans','Montserrat','Poppins','Lora','Cormorant Garamond','Playfair Display'];const ff=safe.includes(c.font_family)?c.font_family:'DM Sans';root.style.setProperty('--custom-font-body',`'${ff}',sans-serif`);root.style.setProperty('--custom-font-heading',`'${ff}',serif`);if(!document.querySelector('[data-custom-font]')){const link=document.createElement('link');link.rel='stylesheet';link.dataset.customFont='1';link.href='https://fonts.googleapis.com/css2?family='+encodeURIComponent(ff).replace(/%20/g,'+')+':wght@400;500;600;700&display=swap';document.head.appendChild(link);}}if(c.background_image){document.body.style.backgroundImage=`url("${String(c.background_image).replace(/["\\]/g,'')}")`;document.body.style.backgroundSize=c.background_mode==='contain'?'contain':c.background_mode==='repeat'?'auto':'cover';document.body.style.backgroundRepeat=c.background_mode==='repeat'?'repeat':'no-repeat';document.body.style.backgroundAttachment='fixed';}if(c.decorative_text){document.body.style.setProperty('--custom-decorations',`"${String(c.decorative_text).replace(/["\\]/g,'')}"`);document.body.classList.add('custom-decorations');}}
    $('gallery-list').innerHTML='';
    (gallery||[]).forEach(g=>{const a=document.createElement('article');a.className='service';const im=document.createElement('img');im.src=db.storage.from('andreea-nails').getPublicUrl(g.image_path).data.publicUrl;im.alt=g.caption||'Lucrare Andreea Nails';im.style='width:100%;height:260px;object-fit:cover';a.appendChild(im);if(g.caption){const p=document.createElement('p');p.textContent=g.caption;a.appendChild(p);} $('gallery-list').appendChild(a);});
  }

  form.addEventListener('submit',async e=>{
    e.preventDefault();
    if(!db){say('Site-ul nu este conectat la Supabase.','error');return;}
    if(!dateInput.value||!timeInput.value){say('Alege o zi și o oră din calendar.','error');return;}
    const f=new FormData(form), payload={client_name:f.get('client_name').trim(),phone:null,social_platform:f.get('social_platform'),social_username:f.get('social_username').trim(),email:f.get('email').trim().toLowerCase(),service:f.get('service'),booking_date:dateInput.value,booking_time:timeInput.value,notes:f.get('notes').trim()||null,status:'pending'};
    const submit=$('submit-booking');submit.disabled=true;submit.textContent='Se trimite...';
    const {error}=await db.from('bookings').insert(payload);
    submit.disabled=false;submit.innerHTML='Trimite solicitarea <span>↗</span>';
    if(error){say(error.message.includes('SLOT_NOT_AVAILABLE')?'Această oră nu mai este disponibilă. Alege alta.':'Nu am putut trimite programarea: '+error.message,'error');await loadSlots(payload.booking_date);await renderCalendar();return;}
    const notice=await db.functions.invoke(cfg.EDGE_FUNCTION_NAME||'quik-worker',{body:{action:'new',booking:payload}});
    if(notice.error){
      console.error('Programarea a fost salvată, dar e-mailul administratorului nu a putut fi trimis:',notice.error);
      say('Programarea a fost salvată, dar notificarea pe e-mail nu a putut fi trimisă. Andreea poate verifica solicitarea în panoul de administrare.','error');
    } else {
      say('Solicitarea a fost trimisă, iar Andreea a primit notificarea pe e-mail. Îți va confirma programarea.','success');
    }
    form.reset();dateInput.value='';timeInput.value='';slots.innerHTML='<p class="muted">Alege o zi din calendar.</p>';await renderCalendar();
  });

  if(db){loadContent();renderCalendar();}else say('Configurarea Supabase nu este completă.','error');
})();
