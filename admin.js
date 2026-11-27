(() => {
  const cfg=window.AN_CONFIG||{},ok=cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY;
  const db=ok?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY):null;
  const $=id=>document.getElementById(id), login=$('login-panel'),dash=$('dashboard');
  const fn=cfg.EDGE_FUNCTION_NAME||'quik-worker';
  const say=(t,c='')=>{$('admin-message').textContent=t;$('admin-message').className='form-message '+c;};
  const loginSay=t=>{$('login-message').textContent=t;};
  const dayNames=['Luni','Marți','Miercuri','Joi','Vineri','Sâmbătă','Duminică'];
  let googleToken=null,googleTokenExpiry=0;
  if(!db){loginSay('Configurația Supabase lipsește.');return;}

  async function load(){const {data:{session}}=await db.auth.getSession();login.hidden=!!session;dash.hidden=!session;if(!session)return;await Promise.all([loadBookings(),loadServices(),loadPhotos(),loadBlocked(),loadContacts(),loadHours(),loadCustomization()]);}
  async function loadBookings(){
    const {data,error}=await db.from('bookings').select('*').order('booking_date').order('booking_time');
    if(error){say('Eroare la programări: '+error.message,'error');return;}
    const body=$('booking-rows');body.innerHTML='';
    (data||[]).forEach(b=>{
      const tr=document.createElement('tr');
      [b.booking_date,String(b.booking_time).slice(0,5),b.client_name,(b.social_platform||'')+' '+(b.social_username||b.phone||''),b.email||'—',b.service,b.status==='pending'?'În așteptare':b.status==='confirmed'?'Confirmată':'Anulată'].forEach(v=>{const td=document.createElement('td');td.textContent=v||'—';tr.appendChild(td);});
      const td=document.createElement('td');
      if(b.status==='pending'){
        const confirm=document.createElement('button');confirm.className='small-action';confirm.textContent='Confirmă';confirm.onclick=()=>updateBooking(b,'confirmed');
        const cancel=document.createElement('button');cancel.className='small-action';cancel.textContent='Anulează';cancel.onclick=()=>updateBooking(b,'cancelled');td.append(confirm,cancel);
      } else if(b.status==='confirmed'){
        const cancel=document.createElement('button');cancel.className='small-action';cancel.textContent='Anulează';cancel.onclick=()=>updateBooking(b,'cancelled');td.append(cancel);
      } else {
        td.textContent='Anulată · ';
        const del=document.createElement('button');del.className='small-action';del.textContent='Șterge';del.onclick=()=>deleteBooking(b.id);td.append(del);
      }
      tr.appendChild(td);body.appendChild(tr);
    });
    say((data||[]).length+' programări încărcate.');
  }
  async function deleteBooking(id){
    if(!confirm('Ștergi definitiv această programare anulată?'))return;
    const {error}=await db.from('bookings').delete().eq('id',id).eq('status','cancelled');
    if(error){say('Nu am putut șterge programarea: '+error.message,'error');return;}
    say('Programarea anulată a fost ștearsă.','success');loadBookings();
  }

  function googleClientId(){return localStorage.getItem('andreea_google_client_id')||$('google-client-id')?.value.trim()||'';}
  function getGoogleToken(prompt=''){
    return new Promise((resolve,reject)=>{
      const clientId=googleClientId();
      if(!clientId){reject(new Error('Adaugă mai întâi Google OAuth Client ID.'));return;}
      if(!window.google?.accounts?.oauth2){reject(new Error('Serviciul Google nu s-a încărcat. Reîncarcă pagina.'));return;}
      const client=google.accounts.oauth2.initTokenClient({client_id:clientId,scope:'https://www.googleapis.com/auth/calendar.events',callback:response=>{
        if(response.error){reject(new Error(response.error));return;}
        googleToken=response.access_token;googleTokenExpiry=Date.now()+(Number(response.expires_in||3600)-60)*1000;resolve(googleToken);
      },error_callback:error=>reject(new Error(error?.message||'Autorizarea Google a fost închisă.'))});
      client.requestAccessToken({prompt:prompt|| (googleToken?'':'consent select_account')});
    });
  }
  async function createGoogleEvent(b){
    if(!googleClientId())return {skipped:true};
    if(!googleToken||Date.now()>googleTokenExpiry)await getGoogleToken();
    const start=`${b.booking_date}T${String(b.booking_time).slice(0,5)}:00`;
    const endDate=new Date(`${start}Z`);endDate.setUTCMinutes(endDate.getUTCMinutes()+60);
    const endLocal=endDate.toISOString().slice(0,19);
    const event={summary:`Andreea Nails – ${b.service} – ${b.client_name}`,description:`Clientă: ${b.client_name}\nE-mail: ${b.email||''}\nContact: ${b.social_platform||''} ${b.social_username||''}\nObservații: ${b.notes||''}`,start:{dateTime:start,timeZone:'Europe/Bucharest'},end:{dateTime:endLocal,timeZone:'Europe/Bucharest'}};
    const response=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events',{method:'POST',headers:{Authorization:`Bearer ${googleToken}`,'Content-Type':'application/json'},body:JSON.stringify(event)});
    const data=await response.json();if(!response.ok)throw new Error(data.error?.message||'Google Calendar nu a acceptat evenimentul.');
    await db.from('bookings').update({google_event_id:data.id}).eq('id',b.id);
    return data;
  }
  async function deleteGoogleEvent(eventId){
    if(!eventId)return;
    if(!googleToken||Date.now()>googleTokenExpiry)await getGoogleToken();
    const response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,{method:'DELETE',headers:{Authorization:`Bearer ${googleToken}`}});
    if(!response.ok&&response.status!==404){const data=await response.json().catch(()=>({}));throw new Error(data.error?.message||'Nu am putut șterge evenimentul din Google Calendar.');}
  }
  async function updateBooking(b,status){
    if(status==='confirmed'&&!confirm('Confirmi programarea?'))return;
    if(status==='cancelled'&&!confirm('Anulezi această programare?'))return;
    const {error}=await db.from('bookings').update({status}).eq('id',b.id);
    if(error){say(error.message,'error');return;}
    const mail=await db.functions.invoke(fn,{body:{action:'status',booking_id:b.id,status}});
    let notes=[];
    if(mail.error)notes.push('E-mailul nu a putut fi trimis.');
    if(status==='confirmed'){
      if(googleClientId()){
        try{await createGoogleEvent(b);notes.push('Eveniment adăugat în Google Calendar.');}
        catch(e){notes.push('Programarea este confirmată, dar Google Calendar: '+e.message);}
      } else notes.push('Conectează Google Calendar pentru sincronizare automată.');
    } else if(b.google_event_id){
      try{await deleteGoogleEvent(b.google_event_id);await db.from('bookings').update({google_event_id:null}).eq('id',b.id);notes.push('Evenimentul a fost eliminat din Google Calendar.');}
      catch(e){notes.push('Evenimentul din Google Calendar trebuie eliminat manual: '+e.message);}
    }
    say((status==='confirmed'?'Programare confirmată. ':'Programare anulată. ')+notes.join(' '),notes.length?'':'success');loadBookings();
  }

  async function loadServices(){const {data,error}=await db.from('site_services').select('*').order('sort_order');if(error){say(error.message,'error');return;}const box=$('service-items');box.innerHTML='';(data||[]).forEach(s=>{const d=document.createElement('div');d.className='item-row';const t=document.createElement('span');t.textContent=s.name+' — '+s.price+' ';d.appendChild(t);const b=document.createElement('button');b.textContent=s.active?'Ascunde':'Reactivează';b.onclick=async()=>{await db.from('site_services').update({active:!s.active}).eq('id',s.id);loadServices();};const del=document.createElement('button');del.textContent='Șterge';del.onclick=async()=>{if(confirm('Ștergi serviciul?')){await db.from('site_services').delete().eq('id',s.id);loadServices();}};d.append(b,del);box.appendChild(d);});}
  async function loadPhotos(){const {data,error}=await db.from('site_gallery').select('*').order('sort_order');if(error){say(error.message,'error');return;}const box=$('photo-items');box.innerHTML='';(data||[]).forEach(p=>{const d=document.createElement('div');d.className='item-row';d.textContent=p.caption||p.image_path.split('/').pop();const b=document.createElement('button');b.textContent='Șterge';b.onclick=async()=>{if(!confirm('Ștergi fotografia?'))return;await db.storage.from('andreea-nails').remove([p.image_path]);await db.from('site_gallery').delete().eq('id',p.id);loadPhotos();};d.appendChild(b);box.appendChild(d);});}
  async function loadBlocked(){const {data,error}=await db.from('blocked_dates').select('*').order('booking_date');if(error)return;const box=$('blocked-items');box.innerHTML='';(data||[]).forEach(x=>{const d=document.createElement('div');d.className='item-row';d.textContent=x.booking_date+' '+(x.reason||'');const b=document.createElement('button');b.textContent='Deblochează';b.onclick=async()=>{await db.from('blocked_dates').delete().eq('booking_date',x.booking_date);loadBlocked();};d.appendChild(b);box.appendChild(d);});}
  async function loadContacts(){const {data}=await db.from('site_settings').select('*').eq('id',1).maybeSingle();if(!data)return;const f=$('contact-form');f.elements.instagram.value=data.instagram||'';f.elements.facebook.value=data.facebook||'';f.elements.contact_note.value=data.contact_note||'';}
  async function loadHours(){
    const {data,error}=await db.from('site_date_availability').select('*').gte('booking_date',new Date().toISOString().slice(0,10)).order('booking_date').order('slot_time');
    if(error){$('hours-list').textContent='Aplică actualizarea nouă a bazei de date pentru ore pe dată.';return;}
    const box=$('hours-list');box.innerHTML='';
    (data||[]).forEach(x=>{const row=document.createElement('div');row.className='item-row';const label=document.createElement('strong');label.textContent=new Date(x.booking_date+'T12:00:00').toLocaleDateString('ro-RO',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})+': ';row.appendChild(label);const chip=document.createElement('span');chip.className='hour-chip';chip.textContent=String(x.slot_time).slice(0,5)+' ';const del=document.createElement('button');del.type='button';del.textContent='×';del.title='Elimină ora';del.onclick=async()=>{if(!confirm('Elimini această oră?'))return;const {error}=await db.from('site_date_availability').delete().eq('booking_date',x.booking_date).eq('slot_time',x.slot_time);if(error)say(error.message,'error');loadHours();};chip.appendChild(del);row.appendChild(chip);box.appendChild(row);});
    if(!(data||[]).length)box.textContent='Nu ai adăugat încă ore disponibile.';
  }
  async function loadCustomization(){const {data}=await db.from('site_customization').select('settings').eq('id',1).maybeSingle();const f=$('custom-form');if(!f)return;const c=data?.settings||{};f.elements.theme.value=c.theme||'classic';f.elements.hero_title.value=c.hero_title||'';f.elements.hero_description.value=c.hero_description||'';f.elements.hero_quote.value=c.hero_quote||'';f.elements.booking_title.value=c.booking_title||'';f.elements.booking_description.value=c.booking_description||'';f.elements.decorations.checked=c.decorations!==false;}


  $('login-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error){loginSay('Autentificare nereușită. Verifică emailul și parola.');return;}loginSay('Autentificare reușită.');load();});
  $('logout').onclick=async()=>{await db.auth.signOut();load();};
  $('service-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{data}=await db.from('site_services').select('sort_order').order('sort_order',{ascending:false}).limit(1).maybeSingle();const {error}=await db.from('site_services').insert({name:f.get('name').trim(),description:f.get('description').trim(),price:f.get('price').trim(),sort_order:(data?.sort_order||0)+1});if(error)say(error.message,'error');else{e.currentTarget.reset();loadServices();say('Serviciul a fost adăugat.','success');}};
  $('photo-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),file=f.get('photo');if(!file||!file.size)return;const path=Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'-');const up=await db.storage.from('andreea-nails').upload(path,file,{upsert:false});if(up.error){say(up.error.message,'error');return;}const {data}=await db.from('site_gallery').select('sort_order').order('sort_order',{ascending:false}).limit(1).maybeSingle();const ins=await db.from('site_gallery').insert({image_path:path,caption:f.get('caption').trim(),sort_order:(data?.sort_order||0)+1});if(ins.error){say(ins.error.message,'error');return;}e.currentTarget.reset();loadPhotos();say('Fotografia a fost încărcată.','success');};
  $('blocked-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.from('blocked_dates').upsert({booking_date:f.get('date'),reason:f.get('reason').trim()});if(error)say(error.message,'error');else{e.currentTarget.reset();loadBlocked();say('Ziua a fost blocată.','success');}};
  $('contact-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.from('site_settings').upsert({id:1,instagram:f.get('instagram').trim(),facebook:f.get('facebook').trim(),contact_note:f.get('contact_note').trim()});if(error)say(error.message,'error');else say('Datele de contact au fost salvate.','success');};
  $('hours-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),date=f.get('date'),slot=f.get('time');const {error}=await db.from('site_date_availability').upsert({booking_date:date,slot_time:slot},{onConflict:'booking_date,slot_time'});if(error)say(error.message,'error');else{e.currentTarget.elements.time.value='';loadHours();say('Ora a fost adăugată pentru '+new Date(date+'T12:00:00').toLocaleDateString('ro-RO')+'.','success');}};
  $('custom-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),settings={theme:f.get('theme'),hero_title:f.get('hero_title').trim(),hero_description:f.get('hero_description').trim(),hero_quote:f.get('hero_quote').trim(),booking_title:f.get('booking_title').trim(),booking_description:f.get('booking_description').trim(),decorations:f.get('decorations')==='on'};const {error}=await db.from('site_customization').upsert({id:1,settings,updated_at:new Date().toISOString()});if(error)say('Nu am putut salva personalizarea: '+error.message,'error');else say('Personalizarea a fost salvată. Reîncarcă site-ul pentru a vedea schimbările.','success');};
  $('google-client-form').onsubmit=e=>{e.preventDefault();const id=$('google-client-id').value.trim();localStorage.setItem('andreea_google_client_id',id);say('ID-ul Google a fost salvat pe acest dispozitiv. Apasă „Conectează” pentru autorizare.','success');};
  $('google-connect').onclick=async()=>{try{await getGoogleToken('consent select_account');say('Google Calendar a fost autorizat în această sesiune.','success');}catch(e){say('Nu am putut conecta Google Calendar: '+e.message,'error');}};
  $('google-client-id').value=localStorage.getItem('andreea_google_client_id')||'';
  db.auth.onAuthStateChange(()=>load());load();
})();
