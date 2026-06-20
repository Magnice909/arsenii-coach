-- Дополнительные поля и права для полной синхронизации кабинетов
alter table public.workouts add column if not exists day text default 'Понедельник';
alter table public.clients add column if not exists user_id uuid references auth.users(id) on delete set null;

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

grant usage on schema public to anon, authenticated, service_role;
grant select on public.site_settings to anon, authenticated;
grant select, insert, update, delete on public.applications to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles to authenticated, service_role;
grant select, insert, update, delete on public.clients to authenticated, service_role;
grant select, insert, update, delete on public.workouts to authenticated, service_role;
grant select, insert, update, delete on public.weekly_plans to authenticated, service_role;
grant select, insert, update, delete on public.push_subscriptions to authenticated, service_role;
grant select, insert, update, delete on public.notifications to authenticated, service_role;
grant select, insert, update, delete on public.site_settings to authenticated, service_role;

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

create table if not exists public.workout_completions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  day_of_week text not null,
  completed_date date not null default current_date,
  created_at timestamp with time zone default now(),
  unique (user_id, workout_id, day_of_week, completed_date)
);

alter table public.workout_completions enable row level security;
grant select, insert, update, delete on public.workout_completions to authenticated, service_role;

drop policy if exists "client can read own completions" on public.workout_completions;
create policy "client can read own completions"
on public.workout_completions
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "client can create own completions" on public.workout_completions;
create policy "client can create own completions"
on public.workout_completions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "coach can read client completions" on public.workout_completions;
create policy "coach can read client completions"
on public.workout_completions
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = workout_completions.client_id
    and clients.coach_id = auth.uid()
  )
);


-- Исправление колонок заявок для стабильной отправки формы
alter table public.applications add column if not exists start_timeline text;
alter table public.applications add column if not exists looking_for text;
alter table public.applications add column if not exists ready_to_invest text;
grant select, insert, update, delete on public.applications to anon, authenticated, service_role;


-- План на следующую неделю
alter table public.clients add column if not exists next_plan_id uuid references public.workouts(id) on delete set null;
alter table public.clients add column if not exists next_plan_week_start date;
