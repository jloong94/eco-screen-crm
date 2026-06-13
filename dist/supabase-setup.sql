-- Eco Screen Supabase setup
-- Run this in Supabase SQL Editor.

create table if not exists public.eco_screen_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.eco_screen_backups (
  id bigint generated always as identity primary key,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.eco_screen_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'sales' check (role in ('admin','sales','production','installer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.eco_screen_state enable row level security;
alter table public.eco_screen_backups enable row level security;
alter table public.eco_screen_profiles enable row level security;

drop policy if exists "eco state read authenticated" on public.eco_screen_state;
create policy "eco state read authenticated"
on public.eco_screen_state for select
to authenticated
using (true);

drop policy if exists "eco state write authenticated" on public.eco_screen_state;
create policy "eco state write authenticated"
on public.eco_screen_state for insert
to authenticated
with check (true);

drop policy if exists "eco state update authenticated" on public.eco_screen_state;
create policy "eco state update authenticated"
on public.eco_screen_state for update
to authenticated
using (true)
with check (true);

drop policy if exists "eco backups read authenticated" on public.eco_screen_backups;
create policy "eco backups read authenticated"
on public.eco_screen_backups for select
to authenticated
using (true);

drop policy if exists "eco backups insert authenticated" on public.eco_screen_backups;
create policy "eco backups insert authenticated"
on public.eco_screen_backups for insert
to authenticated
with check (auth.uid() = created_by);

drop policy if exists "profiles read authenticated" on public.eco_screen_profiles;
create policy "profiles read authenticated"
on public.eco_screen_profiles for select
to authenticated
using (true);

drop policy if exists "profiles self insert" on public.eco_screen_profiles;
create policy "profiles self insert"
on public.eco_screen_profiles for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles self update" on public.eco_screen_profiles;
create policy "profiles self update"
on public.eco_screen_profiles for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create or replace function public.handle_new_eco_screen_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.eco_screen_profiles (id, email, role)
  values (new.id, new.email, 'sales')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_eco_screen on auth.users;
create trigger on_auth_user_created_eco_screen
after insert on auth.users
for each row execute function public.handle_new_eco_screen_user();

-- After creating your boss/admin user, run this with the real email:
-- update public.eco_screen_profiles set role = 'admin' where email = 'boss@email.com';
