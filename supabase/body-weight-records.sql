-- Трекинг веса тела клиента — отдельно от силовых показателей (strength_records),
-- те привязаны к конкретному упражнению, а вес тела один общий показатель.

create table if not exists public.body_weight_records (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  weight_kg numeric not null check (weight_kg > 0),
  recorded_date date not null default current_date,
  created_at timestamp with time zone default now()
);

create index if not exists idx_body_weight_records_client_date on public.body_weight_records (client_id, recorded_date);

alter table public.body_weight_records enable row level security;
grant select, insert, update, delete on public.body_weight_records to authenticated, service_role;

drop policy if exists "clients can manage own body weight records" on public.body_weight_records;
create policy "clients can manage own body weight records"
on public.body_weight_records
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "coach can read client body weight records" on public.body_weight_records;
create policy "coach can read client body weight records"
on public.body_weight_records
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = body_weight_records.client_id
    and clients.coach_id = auth.uid()
  )
);
