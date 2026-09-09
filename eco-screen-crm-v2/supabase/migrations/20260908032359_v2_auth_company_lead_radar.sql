begin;

create table public.crm_v2_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0)
);
create table public.crm_v2_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.crm_v2_companies(id),
  role text not null check (role in ('Boss','Admin','Secretary','Sales','Production','Installer')),
  display_name text not null,
  staff_user_id text,
  active boolean not null default true
);
create index crm_v2_memberships_company_idx on public.crm_v2_memberships(company_id);
alter table public.crm_v2_companies enable row level security;
alter table public.crm_v2_memberships enable row level security;
revoke all on public.crm_v2_companies, public.crm_v2_memberships from public, anon, authenticated;
grant select on public.crm_v2_companies, public.crm_v2_memberships to authenticated;
create policy membership_self on public.crm_v2_memberships for select to authenticated
  using (user_id = (select auth.uid()) and active);
create policy company_member on public.crm_v2_companies for select to authenticated
  using (id in (select company_id from public.crm_v2_memberships where user_id = (select auth.uid()) and active));

-- Preserve the existing company's business data in place. Never copy it into every new company.
alter table public.crm_v2_sync add column company_id uuid references public.crm_v2_companies(id);
do $$
declare existing_company uuid;
begin
  insert into public.crm_v2_companies(name) values ('Eco Screen') returning id into existing_company;
  update public.crm_v2_sync set company_id = existing_company;
end $$;
alter table public.crm_v2_sync alter column company_id set not null;
alter table public.crm_v2_sync drop constraint crm_v2_sync_pkey;
alter table public.crm_v2_sync add primary key (company_id, collection);
alter table public.crm_v2_sync enable row level security;
-- Remove every old permissive policy, including names from historical deployments.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='crm_v2_sync' loop
    execute format('drop policy %I on public.crm_v2_sync', p.policyname);
  end loop;
end $$;
revoke all on public.crm_v2_sync from public, anon, authenticated;
grant select, insert, update on public.crm_v2_sync to authenticated;
create policy sync_read_company on public.crm_v2_sync for select to authenticated
  using (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active));
create policy sync_insert_company on public.crm_v2_sync for insert to authenticated
  with check (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active));
create policy sync_update_company on public.crm_v2_sync for update to authenticated
  using (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active))
  with check (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active));

create table public.crm_v2_prospects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.crm_v2_companies(id),
  name text not null check (length(btrim(name)) > 0),
  prospect_type text not null check (prospect_type in ('customer','partner')),
  classification text not null check (classification in ('hot','warm','partner','ignore')),
  area text not null default '', source_platform text not null default '',
  source_url text not null default '' check (source_url = '' or source_url ~* '^https?://'),
  intent_type text not null default '', business_category text not null default '',
  public_phone text not null default '', public_whatsapp text not null default '', notes text not null default '',
  total_score numeric not null default 0 check (total_score not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  contact_status text not null default 'not_contacted' check (contact_status in
    ('not_contacted','contacted','replied','interested','won','not_interested','do_not_contact')),
  do_not_contact boolean not null default false
);
create index crm_v2_prospects_company_score on public.crm_v2_prospects(company_id,total_score desc);
create index crm_v2_prospects_company_filters on public.crm_v2_prospects(company_id,area,prospect_type,contact_status);
alter table public.crm_v2_prospects enable row level security;
revoke all on public.crm_v2_prospects from public, anon, authenticated;
grant select, insert, update on public.crm_v2_prospects to authenticated;
create policy prospect_read_company on public.crm_v2_prospects for select to authenticated
  using (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active and role in ('Boss','Admin','Secretary','Sales')));
create policy prospect_insert_company on public.crm_v2_prospects for insert to authenticated
  with check (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active and role in ('Boss','Admin','Secretary','Sales')));
create policy prospect_update_company on public.crm_v2_prospects for update to authenticated
  using (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active and role in ('Boss','Admin','Secretary','Sales')))
  with check (company_id in (select company_id from public.crm_v2_memberships where user_id=(select auth.uid()) and active and role in ('Boss','Admin','Secretary','Sales')));
commit;
