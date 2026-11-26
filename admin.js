(() => {
 const cfg=window.AN_CONFIG||{};
 const ok=cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.includes('PASTEAZA');
 const db=ok&&window.supabase?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY):null;
 const $=id=>document.getElementById(id);
 const login=$('login-panel'),dash=$('dashboard');
 const say=(t,c='')=>{const el=$('admin-message');if(el){el.textContent=t;el.className='form-message '+c;}};
 const loginSay=t=>{if($('login-message'))$('login-message').textContent=t;};
 if(!db){loginSay('Configurația Supabase lipsește sau biblioteca nu s-a încărcat. Reîncarcă pagina.');return;}
 const BUCKET='andreea-nails';
 const photoForm=$('photo-form'), photoInput=photoForm?.elements?.photo, photoButton=photoForm?.querySelector('button[type="submit"]');
 if(photoInput){
   photoInput.addEventListener('change',()=>{
     const file=photoInput.files?.[0];
     say(file?`Fotografie selectată: ${file.name}`:'Alege o fotografie JPG, PNG sau WEBP.');
   });
 }
 async function load(){
   const {data:{session},error}=await db.auth.getSession();
   if(error){loginSay('Nu am putut verifica autentificarea: '+error.message);return;}
   login.hidden=!!session;dash.hidden=!session;
   if(!session)return;
   await Promise.all([loadBookings(),loadServices(),loadPhotos(),loadBlocked(),loadContacts()]);
 }
 async function loadBookings(){const {data,error}=await db.from('bookings').select('*').order('booking_date').order('booking_time');if(error){say('Eroare la programări: '+error.message,'error');return;}const body=$('booking-rows');body.innerHTML='';(data||[]).forEach(b=>{const tr=document.createElement('tr');[b.booking_date,String(b.booking_time).slice(0,5),b.client_name,(b.social_platform||'')+' '+(b.social_username||b.phone||''),b.email||'—',b.service,b.status==='pending'?'În așteptare':b.status==='confirmed'?'Confirmată':'Anulată'].forEach(v=>{const td=document.createElement('td');td.textContent=v||'—';tr.appendChild(td);});const td=document.createElement('td');if(b.status!=='cancelled'){const confirm=document.createElement('button');confirm.className='small-action';confirm.textContent=b.status==='confirmed'?'Confirmată':'Confirmă';confirm.disabled=b.status==='confirmed';confirm.onclick=()=>updateBooking(b.id,'confirmed');const cancel=document.createElement('button');cancel.className='small-action';cancel.textContent='Anulează';cancel.onclick=()=>updateBooking(b.id,'cancelled');td.append(confirm,cancel);}else td.textContent='—';tr.appendChild(td);body.appendChild(tr);});say((data||[]).length+' programări încărcate.');}
 async function updateBooking(id,status){const {error}=await db.from('bookings').update({status}).eq('id',id);if(error){say(error.message,'error');return;}const mail=await db.functions.invoke('booking-email',{body:{action:'status',booking_id:id,status}});if(mail.error)say('Statusul a fost actualizat, dar e-mailul nu a putut fi trimis. Verifică setarea serviciului de e-mail.','error');else say(status==='confirmed'?'Programare confirmată. E-mail trimis clientei.':'Programare anulată. E-mail trimis clientei.','success');loadBookings();}
 async function loadServices(){const {data,error}=await db.from('site_services').select('*').order('sort_order');if(error){say('Eroare la servicii: '+error.message,'error');return;}const box=$('service-items');box.innerHTML='';(data||[]).forEach(s=>{const d=document.createElement('div');d.className='item-row';const t=document.createElement('span');t.textContent=s.name+' — '+s.price+' ';d.appendChild(t);const b=document.createElement('button');b.textContent=s.active?'Ascunde':'Reactivează';b.onclick=async()=>{const {error}=await db.from('site_services').update({active:!s.active}).eq('id',s.id);if(error)say(error.message,'error');else loadServices();};const del=document.createElement('button');del.textContent='Șterge';del.onclick=async()=>{if(confirm('Ștergi serviciul?')){const {error}=await db.from('site_services').delete().eq('id',s.id);if(error)say(error.message,'error');else loadServices();}};d.append(b,del);box.appendChild(d);});}
 async function loadPhotos(){const {data,error}=await db.from('site_gallery').select('*').order('sort_order');if(error){say('Eroare la galerie: '+error.message,'error');return;}const box=$('photo-items');box.innerHTML='';(data||[]).forEach(p=>{const d=document.createElement('div');d.className='item-row photo-item';const img=document.createElement('img');img.src=db.storage.from(BUCKET).getPublicUrl(p.image_path).data.publicUrl;img.alt=p.caption||'Fotografie galerie';img.loading='lazy';img.style='width:84px;height:84px;object-fit:cover;border-radius:8px;vertical-align:middle;margin-right:10px';d.appendChild(img);const label=document.createElement('span');label.textContent=p.caption||String(p.image_path||'Fotografie').split('/').pop();d.appendChild(label);const b=document.createElement('button');b.type='button';b.textContent='Șterge';b.onclick=async()=>{if(!confirm('Ștergi fotografia?'))return;const {error:removeError}=await db.storage.from(BUCKET).remove([p.image_path]);if(removeError){say('Nu am putut șterge fișierul: '+removeError.message,'error');return;}const {error:rowError}=await db.from('site_gallery').delete().eq('id',p.id);if(rowError){say('Fișierul a fost șters, dar înregistrarea nu: '+rowError.message,'error');return;}say('Fotografia a fost ștearsă.','success');loadPhotos();};d.appendChild(b);box.appendChild(d);});}
 async function loadBlocked(){const {data,error}=await db.from('blocked_dates').select('*').order('booking_date');if(error){say('Eroare la zile libere: '+error.message,'error');return;}const box=$('blocked-items');box.innerHTML='';(data||[]).forEach(x=>{const d=document.createElement('div');d.className='item-row';d.textContent=x.booking_date+' '+(x.reason||'');const b=document.createElement('button');b.textContent='Deblochează';b.onclick=async()=>{const {error}=await db.from('blocked_dates').delete().eq('booking_date',x.booking_date);if(error)say(error.message,'error');else loadBlocked();};d.appendChild(b);box.appendChild(d);});}
 async function loadContacts(){const {data,error}=await db.from('site_settings').select('*').eq('id',1).maybeSingle();if(error){say('Eroare la contacte: '+error.message,'error');return;}if(!data)return;const f=$('contact-form');f.elements.instagram.value=data.instagram||'';f.elements.facebook.value=data.facebook||'';f.elements.contact_note.value=data.contact_note||'';}
 $('login-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error){loginSay('Autentificare nereușită. Verifică emailul și parola.');return;}loginSay('Autentificare reușită.');load();});
 $('logout').onclick=async()=>{await db.auth.signOut();load();};
 $('service-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{data}=await db.from('site_services').select('sort_order').order('sort_order',{ascending:false}).limit(1).maybeSingle();const {error}=await db.from('site_services').insert({name:f.get('name').trim(),description:f.get('description').trim(),price:f.get('price').trim(),sort_order:(data?.sort_order||0)+1});if(error)say(error.message,'error');else{e.currentTarget.reset();loadServices();say('Serviciul a fost adăugat.','success');}};
 photoForm.onsubmit=async e=>{
   e.preventDefault();
   const file=photoInput?.files?.[0];
   if(!file){say('Mai întâi apasă „Alege fotografie” și selectează o poză din telefon.','error');return;}
   if(!['image/jpeg','image/png','image/webp'].includes(file.type)){say('Format neacceptat. Alege JPG, PNG sau WEBP.','error');return;}
   if(file.size>5*1024*1024){say('Fotografia este prea mare. Limita este 5 MB.','error');return;}
   const caption=String(new FormData(photoForm).get('caption')||'').trim();
   const safeName=file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'-');
   const path=`${Date.now()}-${Math.random().toString(36).slice(2,8)}-${safeName}`;
   if(photoButton){photoButton.disabled=true;photoButton.textContent='Se încarcă...';}
   say('Se încarcă fotografia. Nu închide pagina...');
   try{
     const {error:uploadError}=await db.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});
     if(uploadError)throw new Error('Eroare Storage: '+uploadError.message);
     const {data:last,error:lastError}=await db.from('site_gallery').select('sort_order').order('sort_order',{ascending:false}).limit(1).maybeSingle();
     if(lastError){await db.storage.from(BUCKET).remove([path]);throw new Error('Fișierul s-a încărcat, dar nu pot citi ordinea galeriei: '+lastError.message);}
     const {error:insertError}=await db.from('site_gallery').insert({image_path:path,caption,sort_order:(last?.sort_order||0)+1});
     if(insertError){await db.storage.from(BUCKET).remove([path]);throw new Error('Fișierul s-a încărcat, dar nu a putut fi adăugat în galerie: '+insertError.message);}
     photoForm.reset();say('Fotografia a fost încărcată cu succes!','success');await loadPhotos();
   }catch(err){say(err.message||'Încărcarea fotografiei a eșuat.','error');}
   finally{if(photoButton){photoButton.disabled=false;photoButton.textContent='Încarcă fotografia';}}
 };
 $('blocked-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.from('blocked_dates').upsert({booking_date:f.get('date'),reason:f.get('reason').trim()});if(error)say(error.message,'error');else{e.currentTarget.reset();loadBlocked();say('Ziua a fost blocată.','success');}};
 $('contact-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget),{error}=await db.from('site_settings').upsert({id:1,instagram:f.get('instagram').trim(),facebook:f.get('facebook').trim(),contact_note:f.get('contact_note').trim()});if(error)say(error.message,'error');else say('Datele de contact au fost salvate.','success');};
 db.auth.onAuthStateChange(()=>load());load();
})();
