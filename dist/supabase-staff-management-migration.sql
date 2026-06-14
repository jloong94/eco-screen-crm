-- Eco Screen CRM Staff Management Migration
-- Safe to run more than once.

alter table public.eco_screen_profiles
add column if not exists active boolean not null default true;

alter table public.eco_screen_profiles
drop constraint if exists eco_screen_profiles_role_check;

alter table public.eco_screen_profiles
add constraint eco_screen_profiles_role_check
check (role in ('admin','secretary','sales','production','installer'));

create or replace function public.is_eco_screen_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.eco_screen_profiles
    where id = auth.uid()
      and role = 'admin'
      and coalesce(active, true) = true
  );
$$;

drop policy if exists "profiles admin manage" on public.eco_screen_profiles;
create policy "profiles admin manage"
on public.eco_screen_profiles
for all
to authenticated
using (public.is_eco_screen_admin())
with check (public.is_eco_screen_admin());

drop policy if exists "profiles self update" on public.eco_screen_profiles;
