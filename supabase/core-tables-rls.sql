-- КРИТИЧНО: включает RLS на основных таблицах (clients, workouts,
-- weekly_plans, profiles, site_settings), у которых её никогда не было.
--
-- full-sync.sql выдал этим таблицам широкие GRANT'ы для роли authenticated
-- (select/insert/update/delete), рассчитывая, что доступ дальше ограничат
-- RLS-политики — но политик для них никогда не создавалось. Без RLS
-- GRANT действует буквально: ЛЮБОЙ залогиненный клиент мог через обычный
-- Supabase-клиент в браузере читать и менять данные ВСЕХ клиентов чужого
-- тренера (email, telegram, цель, комментарии тренера), удалять чужие
-- тренировки и, самое опасное, — обновить свою же строку в profiles и
-- выставить себе role = 'coach', получив полный доступ к кабинету тренера.
-- Этот файл закрывает дыру, не трогая уже работающие GRANT'ы.

alter table public.clients enable row level security;
alter table public.workouts enable row level security;
alter table public.weekly_plans enable row level security;
alter table public.profiles enable row level security;
alter table public.site_settings enable row level security;

-- clients: тренер управляет своими клиентами, клиент читает только свою запись.
drop policy if exists "Тренер управляет своими клиентами" on public.clients;
create policy "Тренер управляет своими клиентами"
on public.clients for all
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

drop policy if exists "Клиент читает свою запись" on public.clients;
create policy "Клиент читает свою запись"
on public.clients for select
to authenticated
using (user_id = auth.uid());

-- workouts: тренер управляет своими планами, клиент читает планы своего тренера.
drop policy if exists "Тренер управляет своими планами" on public.workouts;
create policy "Тренер управляет своими планами"
on public.workouts for all
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

drop policy if exists "Клиент читает планы своего тренера" on public.workouts;
create policy "Клиент читает планы своего тренера"
on public.workouts for select
to authenticated
using (
  exists (
    select 1 from public.clients c
    where c.user_id = auth.uid() and c.coach_id = workouts.coach_id
  )
);

-- weekly_plans (устаревшая таблица, но всё ещё читается кабинетами):
-- тренер управляет своими назначениями, клиент читает только свои.
drop policy if exists "Тренер управляет своими weekly_plans" on public.weekly_plans;
create policy "Тренер управляет своими weekly_plans"
on public.weekly_plans for all
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

drop policy if exists "Клиент читает свои weekly_plans" on public.weekly_plans;
create policy "Клиент читает свои weekly_plans"
on public.weekly_plans for select
to authenticated
using (
  exists (
    select 1 from public.clients c
    where c.id = weekly_plans.client_id and c.user_id = auth.uid()
  )
);

-- profiles: каждый видит только свою строку. Запись (создание клиентского
-- аккаунта, смена пароля, назначение role) идёт исключительно через
-- Edge Function create-client-account с service role, которая уже
-- проверяет, что вызывающий — тренер. Никакой политики на insert/update/
-- delete для authenticated НЕ создаём — иначе клиент сможет сам себе
-- переписать role на 'coach' прямо из браузера.
drop policy if exists "Каждый читает свою строку профиля" on public.profiles;
create policy "Каждый читает свою строку профиля"
on public.profiles for select
to authenticated
using (id = auth.uid());

-- site_settings: страница открыта всем (в т.ч. анонимам — публичный лендинг),
-- а менять контент может только тренер.
drop policy if exists "Все читают настройки сайта" on public.site_settings;
create policy "Все читают настройки сайта"
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists "Тренер меняет настройки сайта" on public.site_settings;
create policy "Тренер меняет настройки сайта"
on public.site_settings for all
to authenticated
using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'coach'))
with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.role = 'coach'));
