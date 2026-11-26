-- Andreea Nails: configurare sigură pentru galeria foto.
-- Nu șterge programări și nu modifică tabelele existente.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('andreea-nails', 'andreea-nails', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Public can view Andreea Nails photos" on storage.objects;
create policy "Public can view Andreea Nails photos"
on storage.objects for select
to public
using (bucket_id = 'andreea-nails');

drop policy if exists "Admin can upload Andreea Nails photos" on storage.objects;
create policy "Admin can upload Andreea Nails photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'andreea-nails'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "Admin can update Andreea Nails photos" on storage.objects;
create policy "Admin can update Andreea Nails photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'andreea-nails'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
with check (
  bucket_id = 'andreea-nails'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "Admin can delete Andreea Nails photos" on storage.objects;
create policy "Admin can delete Andreea Nails photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'andreea-nails'
  and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
