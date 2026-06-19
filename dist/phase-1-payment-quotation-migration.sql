-- Eco Screen CRM Phase 1 Migration
-- Safe to run more than once.
-- Adds line-item quotation remarks for product-specific notes.

alter table public.quotation_items
add column if not exists line_remark text;

create index if not exists quotation_items_line_remark_idx
on public.quotation_items(quotation_id);
