-- Phase 2B: Product Settings / Product Management
-- Safe to run more than once. It does not delete or overwrite existing products.

alter table if exists public.products
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists active boolean not null default true;

alter table if exists public.quotation_items
  add column if not exists item_minimum_sqft numeric(12,2) not null default 0;

create index if not exists products_active_idx on public.products(active);
create index if not exists products_category_idx on public.products(category);
