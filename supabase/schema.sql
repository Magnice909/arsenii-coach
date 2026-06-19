create table if not exists public.push_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at timestamp with time zone default now()
);
alter table public.push_subscriptions enable row level security;
create policy "Users can manage own push subscription"
on public.push_subscriptions
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
