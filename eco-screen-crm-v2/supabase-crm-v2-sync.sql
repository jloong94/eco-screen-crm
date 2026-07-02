create table if not exists public.crm_v2_sync (
  collection text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists crm_v2_sync_updated_at_idx
  on public.crm_v2_sync (updated_at desc);

alter table public.crm_v2_sync enable row level security;

drop policy if exists "crm_v2_sync_read" on public.crm_v2_sync;
create policy "crm_v2_sync_read"
  on public.crm_v2_sync
  for select
  using (true);

drop policy if exists "crm_v2_sync_insert" on public.crm_v2_sync;
create policy "crm_v2_sync_insert"
  on public.crm_v2_sync
  for insert
  with check (true);

drop policy if exists "crm_v2_sync_update" on public.crm_v2_sync;
create policy "crm_v2_sync_update"
  on public.crm_v2_sync
  for update
  using (true)
  with check (true);
