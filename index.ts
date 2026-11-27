import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers: cors });
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const adminEmail = Deno.env.get('ADMIN_EMAIL');
  if (!serviceKey) return json({error:'Lipseste secretul Supabase service role din mediul functiei'},500);
  if (!resendKey || !adminEmail) return json({error:'Lipsesc RESEND_API_KEY sau ADMIN_EMAIL'},500);
  const admin = createClient(url, serviceKey);
  const send = async (to:string, subject:string, html:string) => {
    const r = await fetch('https://api.resend.com/emails', {method:'POST', headers:{Authorization:`Bearer ${resendKey}`,'Content-Type':'application/json'}, body:JSON.stringify({from:Deno.env.get('EMAIL_FROM') || 'Andreea Nails <onboarding@resend.dev>',to:[to],subject,html})});
    if (!r.ok) throw new Error(`Resend: ${r.status} ${await r.text()}`);
  };
  try {
    const body = await req.json();
    if (body.action === 'new') {
      const b = body.booking;
      if (!b?.client_name || !b?.email || !b?.booking_date || !b?.booking_time) return json({error:'Date incomplete'},400);
      await send(adminEmail, 'Solicitare nouă de programare – Andreea Nails', `<h2>Solicitare nouă</h2><p><b>${esc(b.client_name)}</b></p><p>${esc(b.service)} · ${esc(b.booking_date)} · ${esc(String(b.booking_time).slice(0,5))}</p><p>E-mail clientă: ${esc(b.email)}</p><p>Contact: ${esc(b.social_platform||'')} ${esc(b.social_username||'')}</p><p>Intră în panoul Andreea Nails pentru a confirma sau anula solicitarea.</p>`);
      return json({ok:true});
    }
    if (body.action === 'status') {
      const auth = req.headers.get('Authorization') || '';
      const token = auth.replace(/^Bearer\s+/i,'');
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '';
      const userClient = createClient(url, anonKey, {global:{headers:{Authorization:`Bearer ${token}`}}});
      const {data:{user}} = await userClient.auth.getUser();
      if (!user || user.app_metadata?.role !== 'admin') return json({error:'Unauthorized'},401);
      const {data:b,error} = await admin.from('bookings').select('*').eq('id',body.booking_id).single();
      if (error || !b?.email) return json({error:'Programarea sau e-mailul lipsesc'},404);
      if (!['confirmed','cancelled'].includes(body.status)) return json({error:'Status invalid'},400);
      const confirmed = body.status === 'confirmed';
      await send(b.email, confirmed?'Programarea ta este confirmată – Andreea Nails':'Actualizare programare – Andreea Nails', `<h2>${confirmed?'Programarea ta a fost confirmată!':'Programarea ta a fost anulată'}</h2><p>Bună, ${esc(b.client_name)}!</p><p>${confirmed?'Te aștept':'Din păcate, nu putem păstra această programare'} în data de <b>${esc(b.booking_date)}</b>, la ora <b>${esc(String(b.booking_time).slice(0,5))}</b>.</p><p>Serviciu: ${esc(b.service)}</p><p>Andreea Nails</p>`);
      return json({ok:true});
    }
    if (body.action === 'reminders') {
      const secret = Deno.env.get('CRON_SECRET');
      if (!secret || req.headers.get('x-cron-secret') !== secret) return json({error:'Unauthorized'},401);
      const now = new Date(); const until = new Date(now.getTime()+24*60*60*1000);
      const {data:rows,error} = await admin.from('bookings').select('*').eq('status','confirmed').is('reminder_sent_at',null).gte('booking_date',now.toISOString().slice(0,10)).lte('booking_date',until.toISOString().slice(0,10));
      if (error) throw error;
      let sent=0;
      for (const b of rows||[]) {
        const local = new Date(`${b.booking_date}T${String(b.booking_time).slice(0,8)}+02:00`);
        if (local.getTime() <= until.getTime() && local.getTime() > now.getTime() && b.email) {
          await send(b.email,'Memento: programarea ta este mâine – Andreea Nails',`<h2>Ne vedem mâine!</h2><p>Bună, ${esc(b.client_name)}! Îți reamintesc că ai o programare la Andreea Nails mâine, ${esc(b.booking_date)}, la ora ${esc(String(b.booking_time).slice(0,5))}.</p><p>Te aștept cu drag!</p>`);
          await admin.from('bookings').update({reminder_sent_at:new Date().toISOString()}).eq('id',b.id); sent++;
        }
      }
      return json({ok:true,sent});
    }
    return json({error:'Acțiune necunoscută'},400);
  } catch (e) { return json({error:String(e)},500); }
});
