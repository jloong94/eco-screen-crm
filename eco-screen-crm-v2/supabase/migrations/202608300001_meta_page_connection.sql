create table if not exists public.meta_page_connections (
  id uuid primary key default gen_random_uuid(),
  page_id text not null unique,
  page_name text not null,
  encrypted_token text not null,
  token_iv text not null,
  token_tag text not null,
  granted_scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected', 'revoked', 'error')),
  webhook_subscribed boolean not null default false,
  last_webhook_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_page_comment_events (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  provider_comment_id text not null unique,
  commenter_id text,
  commenter_name text,
  message text not null,
  commented_at timestamptz not null,
  source_url text,
  page_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.meta_page_connections enable row level security;
alter table public.meta_page_comment_events enable row level security;
revoke all on table public.meta_page_connections from anon, authenticated;
revoke all on table public.meta_page_comment_events from anon, authenticated;
create index if not exists meta_page_comment_events_page_time_idx on public.meta_page_comment_events (page_id, commented_at desc);

create or replace function public.set_meta_private_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function public.set_meta_private_updated_at() from public, anon, authenticated;

drop trigger if exists meta_page_connections_updated_at on public.meta_page_connections;
create trigger meta_page_connections_updated_at before update on public.meta_page_connections
for each row execute function public.set_meta_private_updated_at();

drop trigger if exists meta_page_comment_events_updated_at on public.meta_page_comment_events;
create trigger meta_page_comment_events_updated_at before update on public.meta_page_comment_events
for each row execute function public.set_meta_private_updated_at();
