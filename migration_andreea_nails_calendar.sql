-- ANDREEA NAILS: disponibilitate pe DATA + personalizare site
-- Migrare aditiva: nu sterge programari, servicii, fotografii sau setari existente.

create table if not exists public.site_date_availability (
  booking_date date not null,
  slot_time time without time zone not null,
  created_at timestamptz not null default now(),
  primary key (booking_date, slot_time)
);

alter table public.site_date_availability enable row level security;
drop policy if exists "Public can view date availability" on public.site_date_availability;
create policy "Public can view date availability" on public.site_date_availability
for select to anon, authenticated using (true);
drop policy if exists "Admin can manage date availability" on public.site_date_availability;
create policy "Admin can manage date availability" on public.site_date_availability
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.site_customization (
  id integer primary key default 1 check (id = 1),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.site_customization enable row level security;
drop policy if exists "Public can read site customization" on public.site_customization;
create policy "Public can read site customization" on public.site_customization
for select to anon, authenticated using (true);
drop policy if exists "Admin can manage site customization" on public.site_customization;
create policy "Admin can manage site customization" on public.site_customization
for all to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
insert into public.site_customization(id, settings) values (1, '{"theme":"classic","decorations":true}'::jsonb)
on conflict (id) do nothing;

create or replace function public.get_available_slots(p_date date)
returns table(booking_time time without time zone)
language sql stable security definer set search_path = public
as $$
  select a.slot_time
  from public.site_date_availability a
  where a.booking_date = p_date
    and p_date >= current_date
    and not exists (select 1 from public.blocked_dates x where x.booking_date = p_date)
    and not exists (
      select 1 from public.bookings b
      where b.booking_date = p_date and b.booking_time = a.slot_time
        and b.status in ('pending','confirmed')
    )
  order by a.slot_time;
$$;

create or replace function public.get_month_availability(p_start date, p_end date)
returns table(booking_date date, available_count integer)
language sql stable security definer set search_path = public
as $$
  select d::date,
    case when exists (select 1 from public.blocked_dates x where x.booking_date = d::date)
      then 0
      else count(a.slot_time) filter (where not exists (
        select 1 from public.bookings b
        where b.booking_date = d::date and b.booking_time = a.slot_time
          and b.status in ('pending','confirmed')
      ))::integer
    end as available_count
  from generate_series(greatest(p_start, current_date)::timestamp,
                       p_end::timestamp, interval '1 day') as d
  left join public.site_date_availability a on a.booking_date = d::date
  group by d
  order by d;
$$;
grant execute on function public.get_available_slots(date) to anon, authenticated;
grant execute on function public.get_month_availability(date,date) to anon, authenticated;

create or replace function public.validate_andreea_booking_slot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('pending','confirmed') then
    if exists (select 1 from public.blocked_dates x where x.booking_date = new.booking_date) then
      raise exception 'SLOT_NOT_AVAILABLE: zi blocata';
    end if;
    if not exists (select 1 from public.site_date_availability a
                   where a.booking_date = new.booking_date and a.slot_time = new.booking_time) then
      raise exception 'SLOT_NOT_AVAILABLE: ora nu este in program';
    end if;
    if exists (select 1 from public.bookings b
               where b.booking_date = new.booking_date and b.booking_time = new.booking_time
                 and b.status in ('pending','confirmed')
                 and (tg_op = 'INSERT' or b.id <> new.id)) then
      raise exception 'SLOT_NOT_AVAILABLE: ora ocupata';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists validate_andreea_booking_slot on public.bookings;
create trigger validate_andreea_booking_slot
before insert or update of booking_date, booking_time, status on public.bookings
for each row execute function public.validate_andreea_booking_slot();

-- Campuri auxiliare folosite de sincronizarea Google Calendar si remindere.
alter table public.bookings add column if not exists google_event_id text;
alter table public.bookings add column if not exists reminder_sent_at timestamptz;
-- Permisiuni admin pentru actualizare/stergere programari anulate.
drop policy if exists "Admin can update bookings" on public.bookings;
create policy "Admin can update bookings" on public.bookings for update to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
drop policy if exists "Admin can delete bookings" on public.bookings;
create policy "Admin can delete bookings" on public.bookings for delete to authenticated
using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
