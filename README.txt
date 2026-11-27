ANDREEA NAILS — RECONSTRUCȚIE COMPLETĂ

Fișiere:
index.html      site public
admin.html      panou administrare
app.js          calendar + programări + conținut public
admin.js        administrare
style.css       design
config.js       configurarea Supabase
migration.sql   SQL aditiv pentru calendar/personalizare/validare
supabase/functions/quik-worker/index.ts  notificare Resend

IMPORTANT: nu șterge bookings, site_services, site_gallery sau site_settings.
Înainte de publicare rulează SQL-ul din migration.sql în Supabase.
Păstrează config.js cu publishable key, nu service_role.
