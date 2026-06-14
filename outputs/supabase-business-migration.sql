-- Eco Screen CRM Supabase business tables migration
-- Run this in Supabase SQL Editor after or together with supabase-setup.sql.

create table if not exists public.customers (
  id text primary key,
  name text,
  phone text,
  address text,
  area text,
  appointment_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotations (
  id text primary key,
  quote_no text unique,
  customer_id text references public.customers(id) on delete set null,
  status text not null default 'quoted',
  total numeric(12,2) not null default 0,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  deposit numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quotations
add column if not exists remarks text,
add column if not exists subtotal numeric(12,2) not null default 0,
add column if not exists discount numeric(12,2) not null default 0;

create table if not exists public.quotation_items (
  id text primary key,
  quotation_id text references public.quotations(id) on delete cascade,
  sort_order integer not null default 1,
  line_label text,
  product_id text,
  product_name text,
  width_mm numeric(12,2) not null default 0,
  height_mm numeric(12,2) not null default 0,
  quantity numeric(12,2) not null default 0,
  actual_sqft numeric(12,2) not null default 0,
  chargeable_sqft numeric(12,2) not null default 0,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  track_type text,
  track_width_mm numeric(12,2) not null default 0,
  track_height_mm numeric(12,2) not null default 0,
  handle_height_mm numeric(12,2) not null default 0,
  installation_type text,
  opening_direction text
);

alter table public.quotation_items
add column if not exists track_type text,
add column if not exists track_width_mm numeric(12,2) not null default 0,
add column if not exists track_height_mm numeric(12,2) not null default 0,
add column if not exists handle_height_mm numeric(12,2) not null default 0,
add column if not exists installation_type text,
add column if not exists opening_direction text;

create table if not exists public.production_orders (
  id text primary key,
  production_no text unique,
  order_no text,
  quote_no text,
  customer_id text references public.customers(id) on delete set null,
  status text not null default 'pending-production',
  items jsonb not null default '[]'::jsonb,
  inventory_deducted boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.installations (
  id text primary key,
  installation_no text unique,
  order_no text,
  quote_no text,
  customer_id text references public.customers(id) on delete set null,
  installation_date date,
  completed_date date,
  installer_name text,
  status text not null default 'pending-installation',
  balance numeric(12,2) not null default 0,
  customer_rating numeric(3,1) not null default 0,
  photo_uploaded boolean not null default false,
  referred_friend boolean not null default false,
  referral_note text,
  checklist jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  signature text,
  installation_notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.collections (
  id text primary key,
  order_id text,
  order_no text,
  customer_id text references public.customers(id) on delete set null,
  label text,
  amount numeric(12,2) not null default 0,
  method text,
  payment_date date,
  remark text,
  created_at timestamptz not null default now()
);

create table if not exists public.appointments (
  id text primary key,
  customer_name text,
  phone text,
  address text,
  product text,
  appointment_date date,
  appointment_time time,
  assigned_staff text,
  remarks text,
  google_event_id text,
  google_event_link text,
  google_status text,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_phone_idx on public.customers(phone);
create index if not exists quotations_customer_id_idx on public.quotations(customer_id);
create index if not exists quotation_items_quotation_id_idx on public.quotation_items(quotation_id);
create index if not exists production_orders_customer_id_idx on public.production_orders(customer_id);
create index if not exists installations_customer_id_idx on public.installations(customer_id);
create index if not exists collections_customer_id_idx on public.collections(customer_id);
create index if not exists appointments_date_staff_idx on public.appointments(appointment_date, assigned_staff);

alter table public.customers enable row level security;
alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;
alter table public.production_orders enable row level security;
alter table public.installations enable row level security;
alter table public.collections enable row level security;
alter table public.appointments enable row level security;

drop policy if exists "customers authenticated read" on public.customers;
create policy "customers authenticated read" on public.customers
for select to authenticated using (true);

drop policy if exists "customers authenticated write" on public.customers;
create policy "customers authenticated write" on public.customers
for all to authenticated using (true) with check (true);

drop policy if exists "quotations authenticated read" on public.quotations;
create policy "quotations authenticated read" on public.quotations
for select to authenticated using (true);

drop policy if exists "quotations authenticated write" on public.quotations;
create policy "quotations authenticated write" on public.quotations
for all to authenticated using (true) with check (true);

drop policy if exists "quotation_items authenticated read" on public.quotation_items;
create policy "quotation_items authenticated read" on public.quotation_items
for select to authenticated using (true);

drop policy if exists "quotation_items authenticated write" on public.quotation_items;
create policy "quotation_items authenticated write" on public.quotation_items
for all to authenticated using (true) with check (true);

drop policy if exists "production_orders authenticated read" on public.production_orders;
create policy "production_orders authenticated read" on public.production_orders
for select to authenticated using (true);

drop policy if exists "production_orders authenticated write" on public.production_orders;
create policy "production_orders authenticated write" on public.production_orders
for all to authenticated using (true) with check (true);

drop policy if exists "installations authenticated read" on public.installations;
create policy "installations authenticated read" on public.installations
for select to authenticated using (true);

drop policy if exists "installations authenticated write" on public.installations;
create policy "installations authenticated write" on public.installations
for all to authenticated using (true) with check (true);

drop policy if exists "collections authenticated read" on public.collections;
create policy "collections authenticated read" on public.collections
for select to authenticated using (true);

drop policy if exists "collections authenticated write" on public.collections;
create policy "collections authenticated write" on public.collections
for all to authenticated using (true) with check (true);

drop policy if exists "appointments authenticated read" on public.appointments;
create policy "appointments authenticated read" on public.appointments
for select to authenticated using (true);

drop policy if exists "appointments authenticated write" on public.appointments;
create policy "appointments authenticated write" on public.appointments
for all to authenticated using (true) with check (true);

-- Role setup:
-- Users are created through Supabase Auth.
-- Their app role is stored in public.eco_screen_profiles.role.
-- Supported roles in the current app: admin, secretary, sales, production, installer.
-- Example:
-- update public.eco_screen_profiles set role = 'admin' where email = 'boss@email.com';
-- update public.eco_screen_profiles set role = 'secretary' where email = 'secretary@email.com';
-- update public.eco_screen_profiles set role = 'sales' where email = 'sales@email.com';
-- update public.eco_screen_profiles set role = 'installer' where email = 'installer@email.com';
