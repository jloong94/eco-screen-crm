create table if not exists public.eco_screen_v2_collections (
  collection text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists eco_screen_v2_collections_updated_at_idx
  on public.eco_screen_v2_collections (updated_at desc);

alter table public.eco_screen_v2_collections enable row level security;

drop policy if exists "eco_screen_v2_read" on public.eco_screen_v2_collections;
create policy "eco_screen_v2_read"
  on public.eco_screen_v2_collections
  for select
  using (true);

drop policy if exists "eco_screen_v2_insert" on public.eco_screen_v2_collections;
create policy "eco_screen_v2_insert"
  on public.eco_screen_v2_collections
  for insert
  with check (true);

drop policy if exists "eco_screen_v2_update" on public.eco_screen_v2_collections;
create policy "eco_screen_v2_update"
  on public.eco_screen_v2_collections
  for update
  using (true)
  with check (true);
