-- Eco Screen CRM Supabase Primary Database Migration
-- Safe to run more than once.
-- This adds the tables needed when Supabase is the main database instead of localStorage.

create table if not exists public.products (
  id text primary key,
  name text not null,
  price numeric(12,2) not null default 0,
  minimum_sqft numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id text primary key,
  order_no text unique,
  quote_no text,
  customer_id text references public.customers(id) on delete set null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  deposit numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  costs jsonb not null default '{}'::jsonb,
  installation_date date,
  installation_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id text primary key,
  category text,
  name text not null,
  unit text,
  quantity numeric(12,2) not null default 0,
  safety_quantity numeric(12,2) not null default 0,
  usage_per_item numeric(12,4) not null default 0,
  rmb_unit_cost numeric(12,2) not null default 0,
  unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff (
  id text primary key,
  name text not null,
  role text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.products
add column if not exists name text,
add column if not exists price numeric(12,2) not null default 0,
add column if not exists minimum_sqft numeric(12,2) not null default 0,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.orders
add column if not exists order_no text,
add column if not exists quote_no text,
add column if not exists customer_id text references public.customers(id) on delete set null,
add column if not exists items jsonb not null default '[]'::jsonb,
add column if not exists subtotal numeric(12,2) not null default 0,
add column if not exists discount numeric(12,2) not null default 0,
add column if not exists total numeric(12,2) not null default 0,
add column if not exists deposit numeric(12,2) not null default 0,
add column if not exists balance numeric(12,2) not null default 0,
add column if not exists costs jsonb not null default '{}'::jsonb,
add column if not exists installation_date date,
add column if not exists installation_notes text,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.inventory_items
add column if not exists category text,
add column if not exists name text,
add column if not exists unit text,
add column if not exists quantity numeric(12,2) not null default 0,
add column if not exists safety_quantity numeric(12,2) not null default 0,
add column if not exists usage_per_item numeric(12,4) not null default 0,
add column if not exists rmb_unit_cost numeric(12,2) not null default 0,
add column if not exists unit_cost numeric(12,2) not null default 0,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.staff
add column if not exists name text,
add column if not exists role text,
add column if not exists phone text,
add column if not exists active boolean not null default true,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.app_settings
add column if not exists value jsonb not null default '{}'::jsonb,
add column if not exists updated_at timestamptz not null default now();

create index if not exists orders_customer_id_idx on public.orders(customer_id);
create index if not exists orders_quote_no_idx on public.orders(quote_no);
create index if not exists inventory_items_category_idx on public.inventory_items(category);
create index if not exists staff_role_idx on public.staff(role);

alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.inventory_items enable row level security;
alter table public.staff enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "products authenticated read" on public.products;
create policy "products authenticated read" on public.products
for select to authenticated using (true);

drop policy if exists "products authenticated write" on public.products;
create policy "products authenticated write" on public.products
for all to authenticated using (true) with check (true);

drop policy if exists "orders authenticated read" on public.orders;
create policy "orders authenticated read" on public.orders
for select to authenticated using (true);

drop policy if exists "orders authenticated write" on public.orders;
create policy "orders authenticated write" on public.orders
for all to authenticated using (true) with check (true);

drop policy if exists "inventory authenticated read" on public.inventory_items;
create policy "inventory authenticated read" on public.inventory_items
for select to authenticated using (true);

drop policy if exists "inventory authenticated write" on public.inventory_items;
create policy "inventory authenticated write" on public.inventory_items
for all to authenticated using (true) with check (true);

drop policy if exists "staff authenticated read" on public.staff;
create policy "staff authenticated read" on public.staff
for select to authenticated using (true);

drop policy if exists "staff authenticated write" on public.staff;
create policy "staff authenticated write" on public.staff
for all to authenticated using (true) with check (true);

drop policy if exists "app settings authenticated read" on public.app_settings;
create policy "app settings authenticated read" on public.app_settings
for select to authenticated using (true);

drop policy if exists "app settings authenticated write" on public.app_settings;
create policy "app settings authenticated write" on public.app_settings
for all to authenticated using (true) with check (true);
