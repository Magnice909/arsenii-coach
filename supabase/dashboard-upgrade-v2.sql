-- Второй раунд улучшений кабинетов: теги клиентов, учёт оплаты, заметки
-- тренера, шаблоны планов, дневник питания, цели клиента, гибкое время
-- push-напоминаний о тренировке.

-- ===== clients: теги и дата следующей оплаты =====
alter table public.clients add column if not exists tag text;
alter table public.clients add column if not exists next_payment_date date;

-- ===== workouts: пометка "это шаблон" =====
alter table public.workouts add column if not exists is_template boolean not null default false;

-- ===== client_notes: приватный журнал тренера по каждому клиенту =====
create table if not exists public.client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  created_at timestamp with time zone default now()
);

create index if not exists idx_client_notes_client on public.client_notes (client_id, created_at desc);

alter table public.client_notes enable row level security;
grant select, insert, update, delete on public.client_notes to authenticated, service_role;

drop policy if exists "coach manages own client notes" on public.client_notes;
create policy "coach manages own client notes"
on public.client_notes
for all
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

-- ===== nutrition_logs: дневник питания, клиент ведёт сам =====
create table if not exists public.nutrition_logs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null,
  calories integer,
  logged_date date not null default current_date,
  created_at timestamp with time zone default now()
);

create index if not exists idx_nutrition_logs_client_date on public.nutrition_logs (client_id, logged_date desc);

alter table public.nutrition_logs enable row level security;
grant select, insert, update, delete on public.nutrition_logs to authenticated, service_role;

drop policy if exists "clients can manage own nutrition logs" on public.nutrition_logs;
create policy "clients can manage own nutrition logs"
on public.nutrition_logs
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "coach can read client nutrition logs" on public.nutrition_logs;
create policy "coach can read client nutrition logs"
on public.nutrition_logs
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = nutrition_logs.client_id
    and clients.coach_id = auth.uid()
  )
);

-- ===== client_goals: цель клиента (целевой вес), ставит сам клиент =====
create table if not exists public.client_goals (
  client_id uuid primary key references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_weight_kg numeric,
  updated_at timestamp with time zone default now()
);

alter table public.client_goals enable row level security;
grant select, insert, update, delete on public.client_goals to authenticated, service_role;

drop policy if exists "clients can manage own goal" on public.client_goals;
create policy "clients can manage own goal"
on public.client_goals
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "coach can read client goal" on public.client_goals;
create policy "coach can read client goal"
on public.client_goals
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = client_goals.client_id
    and clients.coach_id = auth.uid()
  )
);

-- ===== push_subscriptions: время суток для напоминания о завтрашней тренировке =====
-- Клиент сам управляет этой строкой (политика "Users can manage own push
-- subscription" уже есть в schema.sql), поэтому отдельных политик не нужно.
alter table public.push_subscriptions add column if not exists reminder_hour smallint;
alter table public.push_subscriptions add column if not exists reminder_enabled boolean not null default true;
