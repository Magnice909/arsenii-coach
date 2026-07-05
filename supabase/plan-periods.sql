-- Планы тренировок на конкретные 7-дневные периоды.
--
-- Раньше план клиента был "вечным" недельным шаблоном без дат начала/конца
-- (плюс отдельные next_plan_id/next_plan_week_start для одного "следующего"
-- плана, без полноценной истории периодов). Это создавало путаницу: план,
-- назначенный один раз, в календаре проецировался на все недели бессрочно.
--
-- Теперь у каждого периода есть start_date и end_date (всегда 7 дней).
-- "Текущий план" клиента — это период, где start_date <= сегодня <= end_date.
-- Переход на новый период происходит САМ, без ручных действий и без cron —
-- это просто результат сравнения дат при каждом запросе.

create table if not exists public.plan_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now(),
  constraint plan_periods_week check (end_date = start_date + 6)
);

create index if not exists idx_plan_periods_client_dates on public.plan_periods (client_id, start_date, end_date);

alter table public.plan_periods enable row level security;

-- Тренер управляет периодами своих клиентов.
drop policy if exists "Тренер управляет периодами своих клиентов" on public.plan_periods;
create policy "Тренер управляет периодами своих клиентов"
on public.plan_periods for all
to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.coach_id = auth.uid()))
with check (exists (select 1 from public.clients c where c.id = client_id and c.coach_id = auth.uid()));

-- Клиент читает свои периоды (для календаря в своём кабинете).
drop policy if exists "Клиент читает свои периоды" on public.plan_periods;
create policy "Клиент читает свои периоды"
on public.plan_periods for select
to authenticated
using (exists (select 1 from public.clients c where c.id = client_id and c.user_id = auth.uid()));
