-- Eco Screen CRM Phase 1 Migration
-- Safe to run more than once.
-- Adds line-item quotation remarks for product-specific notes.

alter table public.quotation_items
add column if not exists line_remark text;

create index if not exists quotation_items_line_remark_idx
on public.quotation_items(quotation_id);

alter table public.collections
add column if not exists quotation_id text,
add column if not exists customer_name text,
add column if not exists source text,
add column if not exists reference text,
add column if not exists installation_id text;

create index if not exists collections_source_idx
on public.collections(source);

create index if not exists collections_reference_idx
on public.collections(reference);
