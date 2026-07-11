-- Таблица notifications была когда-то создана прямо в Supabase Studio (не через
-- SQL-миграции этого репозитория), поэтому у неё либо не было политик RLS вовсе,
-- либо RLS был включён без единой политики. В обоих случаях коуч не видел новых
-- событий во вкладке «Сообщения», когда клиент отмечал тренировку выполненной:
-- INSERT от клиента либо тихо не проходил, либо SELECT коуча возвращал 0 строк.
-- Ниже — полное и идемпотентное описание таблицы и её политик.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  title text,
  body text,
  url text,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

alter table public.notifications add column if not exists recipient_id uuid references auth.users(id) on delete cascade;
alter table public.notifications add column if not exists sender_id uuid references auth.users(id) on delete set null;
alter table public.notifications add column if not exists read_at timestamp with time zone;
alter table public.notifications add column if not exists created_at timestamp with time zone default now();

alter table public.notifications enable row level security;
grant select, insert, update, delete on public.notifications to authenticated, service_role;

drop policy if exists "recipient can read own notifications" on public.notifications;
create policy "recipient can read own notifications"
on public.notifications
for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists "authenticated user can send notifications" on public.notifications;
create policy "authenticated user can send notifications"
on public.notifications
for insert
to authenticated
with check (sender_id = auth.uid());

drop policy if exists "recipient can mark own notifications read" on public.notifications;
create policy "recipient can mark own notifications read"
on public.notifications
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());
