create table if not exists public.crm_stable_sync (
  collection text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);

alter table public.crm_stable_sync enable row level security;

create policy "crm_stable_sync_select"
on public.crm_stable_sync
for select
using (true);

create policy "crm_stable_sync_upsert"
on public.crm_stable_sync
for all
using (true)
with check (true);
