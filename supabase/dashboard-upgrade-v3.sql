-- Третий раунд улучшений кабинетов: библиотека упражнений тренера
-- (единая лента, экспорт в CSV и подсветка просроченной оплаты работают
-- на уже существующих таблицах и новых миграций не требуют).

-- ===== exercise_library: сохранённые упражнения тренера (название + группа мышц) =====
-- Подходы/повторы в шаблоне не хранятся — тренер вписывает их вручную
-- при вставке в конкретный план, они отличаются от клиента к клиенту.
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
