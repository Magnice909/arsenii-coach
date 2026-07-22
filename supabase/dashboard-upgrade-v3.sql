-- Третий раунд улучшений кабинетов: библиотека упражнений тренера и
-- прогресс-фото клиента (единая лента и CSV-экспорт работают на уже
-- существующих таблицах и новых миграций не требуют).

-- ===== exercise_library: сохранённые упражнения тренера для быстрой вставки =====
create table if not exists public.exercise_library (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  muscle_group text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_exercise_library_coach on public.exercise_library (coach_id, label);

alter table public.exercise_library enable row level security;
grant select, insert, update, delete on public.exercise_library to authenticated, service_role;

drop policy if exists "coach manages own exercise library" on public.exercise_library;
create policy "coach manages own exercise library"
on public.exercise_library
for all
to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

-- ===== progress_photos: фото до/после, клиент ведёт сам =====
create table if not exists public.progress_photos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  taken_date date not null default current_date,
  created_at timestamp with time zone default now()
);

create index if not exists idx_progress_photos_client_date on public.progress_photos (client_id, taken_date desc);

alter table public.progress_photos enable row level security;
grant select, insert, update, delete on public.progress_photos to authenticated, service_role;

drop policy if exists "clients can manage own progress photos" on public.progress_photos;
create policy "clients can manage own progress photos"
on public.progress_photos
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "coach can read client progress photos" on public.progress_photos;
create policy "coach can read client progress photos"
on public.progress_photos
for select
to authenticated
using (
  exists (
    select 1 from public.clients
    where clients.id = progress_photos.client_id
    and clients.coach_id = auth.uid()
  )
);

-- ===== Storage: приватный bucket для прогресс-фото =====
-- ВАЖНО: сам bucket нужно создать один раз в Supabase Dashboard:
--   Storage → New bucket → имя "progress-photos" → Public bucket: ВЫКЛЮЧЕНО
--   (фото приватные, в отличие от site-assets, поэтому bucket НЕ публичный —
--   доступ только по подписанным временным ссылкам через RLS ниже).
-- После создания bucket выполните этот блок.

drop policy if exists "clients and coach manage progress photos" on storage.objects;
create policy "clients and coach manage progress photos"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'progress-photos'
  and exists (
    select 1 from public.clients
    where clients.id::text = (storage.foldername(name))[1]
    and (clients.user_id = auth.uid() or clients.coach_id = auth.uid())
  )
)
with check (
  bucket_id = 'progress-photos'
  and exists (
    select 1 from public.clients
    where clients.id::text = (storage.foldername(name))[1]
    and (clients.user_id = auth.uid() or clients.coach_id = auth.uid())
  )
);
