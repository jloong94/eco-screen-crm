-- Eco Screen CRM incremental migration
-- Run this once in Supabase SQL Editor if your project was created before the Secretary and quotation remarks upgrade.

alter table public.eco_screen_profiles
drop constraint if exists eco_screen_profiles_role_check;

alter table public.eco_screen_profiles
add constraint eco_screen_profiles_role_check
check (role in ('admin','secretary','sales','production','installer'));

alter table public.quotations
add column if not exists remarks text,
add column if not exists subtotal numeric(12,2) not null default 0,
add column if not exists discount numeric(12,2) not null default 0;

-- Example role update:
-- update public.eco_screen_profiles set role = 'secretary' where email = 'secretary@email.com';
