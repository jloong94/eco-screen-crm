-- Phase 3B: Inventory metadata and Product Material Mapping
-- Safe to run more than once. It does not delete, overwrite, or clear existing data.

alter table if exists public.inventory_items
  add column if not exists item_type text,
  add column if not exists stock_unit text,
  add column if not exists purchase_unit text,
  add column if not exists pcs_per_bundle numeric(12,4) not null default 0,
  add column if not exists length_mm_per_piece numeric(12,2) not null default 0,
  add column if not exists meter_per_roll numeric(12,4) not null default 0,
  add column if not exists cost_per_stock_unit numeric(12,4) not null default 0,
  add column if not exists exclude_from_auto_deduct boolean not null default false,
  add column if not exists active boolean not null default true;

create table if not exists public.product_material_mappings (
  id text primary key,
  product_id text not null,
  inventory_item_id text not null,
  material_role text not null default 'frame',
  formula_type text not null default 'per_qty',
  base_qty numeric(12,4) not null default 1,
  wastage_percent numeric(8,2) not null default 0,
  deduct_unit text not null default 'pcs',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.product_material_mappings
  add column if not exists product_id text,
  add column if not exists inventory_item_id text,
  add column if not exists material_role text not null default 'frame',
  add column if not exists formula_type text not null default 'per_qty',
  add column if not exists base_qty numeric(12,4) not null default 1,
  add column if not exists wastage_percent numeric(8,2) not null default 0,
  add column if not exists deduct_unit text not null default 'pcs',
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists inventory_items_item_type_idx on public.inventory_items(item_type);
create index if not exists inventory_items_active_idx on public.inventory_items(active);
create index if not exists product_material_mappings_product_idx on public.product_material_mappings(product_id);
create index if not exists product_material_mappings_inventory_idx on public.product_material_mappings(inventory_item_id);
create index if not exists product_material_mappings_active_idx on public.product_material_mappings(active);

alter table public.product_material_mappings enable row level security;

drop policy if exists "product material mappings authenticated read" on public.product_material_mappings;
create policy "product material mappings authenticated read" on public.product_material_mappings
for select to authenticated using (true);

drop policy if exists "product material mappings authenticated write" on public.product_material_mappings;
create policy "product material mappings authenticated write" on public.product_material_mappings
for all to authenticated using (true) with check (true);
