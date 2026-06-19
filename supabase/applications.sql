create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  goal text,
  duration text,
  obstacle text,
  commitment text,
  startTimeline text,
  lookingFor text,
  readyToInvest text,
  telegram text not null,
  email text not null,
  instagram text,
  status text default 'Новая',
  created_at timestamp with time zone default now()
);

alter table public.applications enable row level security;

grant select, insert, update, delete on public.applications to anon, authenticated;

drop policy if exists "anyone can create application" on public.applications;
create policy "anyone can create application"
on public.applications
for insert
to anon, authenticated
with check (true);

drop policy if exists "coach can read applications" on public.applications;
create policy "coach can read applications"
on public.applications
for select
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'coach'
  )
);

drop policy if exists "coach can update applications" on public.applications;
create policy "coach can update applications"
on public.applications
for update
to authenticated
using (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'coach'
  )
)
with check (
  exists (
    select 1 from public.profiles
    where profiles.id = auth.uid()
    and profiles.role = 'coach'
  )
);
