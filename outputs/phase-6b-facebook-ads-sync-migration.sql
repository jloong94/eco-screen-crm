create extension if not exists pgcrypto;

create table if not exists public.facebook_ad_accounts (
  id text primary key default 'main',
  ad_account_id text,
  account_name text,
  currency text,
  active boolean default true,
  last_synced_at timestamptz,
  sync_status text,
  sync_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.facebook_ads_daily (
  id text primary key,
  date date not null,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric default 0,
  impressions numeric default 0,
  reach numeric default 0,
  clicks numeric default 0,
  inline_link_clicks numeric default 0,
  whatsapp_conversations numeric default 0,
  leads numeric default 0,
  appointments numeric default 0,
  closed_orders numeric default 0,
  revenue numeric default 0,
  lead_quality text,
  source text default 'meta',
  raw_meta jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.facebook_sync_logs (
  id uuid primary key default gen_random_uuid(),
  sync_started_at timestamptz,
  sync_finished_at timestamptz,
  date_from date,
  date_to date,
  status text,
  error_message text,
  rows_synced integer default 0
);

create unique index if not exists facebook_ads_daily_unique_day_ad
on public.facebook_ads_daily (date, campaign_id, adset_id, ad_id);

create index if not exists facebook_ads_daily_date_idx
on public.facebook_ads_daily (date desc);

create index if not exists facebook_ads_daily_campaign_idx
on public.facebook_ads_daily (campaign_name);

create index if not exists facebook_sync_logs_started_idx
on public.facebook_sync_logs (sync_started_at desc);

alter table public.facebook_ad_accounts enable row level security;
alter table public.facebook_ads_daily enable row level security;
alter table public.facebook_sync_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'facebook_ad_accounts'
      and policyname = 'facebook_ad_accounts_authenticated_select'
  ) then
    create policy facebook_ad_accounts_authenticated_select
    on public.facebook_ad_accounts
    for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'facebook_ads_daily'
      and policyname = 'facebook_ads_daily_authenticated_select'
  ) then
    create policy facebook_ads_daily_authenticated_select
    on public.facebook_ads_daily
    for select
    to authenticated
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'facebook_sync_logs'
      and policyname = 'facebook_sync_logs_authenticated_select'
  ) then
    create policy facebook_sync_logs_authenticated_select
    on public.facebook_sync_logs
    for select
    to authenticated
    using (true);
  end if;
end $$;
