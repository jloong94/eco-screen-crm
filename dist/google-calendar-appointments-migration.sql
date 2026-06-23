-- Eco Screen CRM Google Calendar Appointment Module Migration
-- Safe to run more than once.
-- This migration only creates/updates public.appointments and its appointment-related index/policies.

create table if not exists public.appointments (
  id text primary key,
  customer_name text,
  phone text,
  address text,
  product text,
  appointment_date date,
  appointment_time time,
  assigned_staff text,
  remarks text,
  google_event_id text,
  google_event_link text,
  google_status text,
  google_sync_error text,
  google_last_synced_at timestamptz,
  status text not null default 'scheduled',
  cancelled_at timestamptz,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointments
add column if not exists customer_name text,
add column if not exists phone text,
add column if not exists address text,
add column if not exists product text,
add column if not exists appointment_date date,
add column if not exists appointment_time time,
add column if not exists assigned_staff text,
add column if not exists remarks text,
add column if not exists google_event_id text,
add column if not exists google_event_link text,
add column if not exists google_status text,
add column if not exists google_sync_error text,
add column if not exists google_last_synced_at timestamptz,
add column if not exists status text not null default 'scheduled',
add column if not exists cancelled_at timestamptz,
add column if not exists reminder_sent_at timestamptz,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

create index if not exists appointments_date_staff_idx
on public.appointments(appointment_date, assigned_staff);

create index if not exists appointments_google_event_id_idx
on public.appointments(google_event_id);

create index if not exists appointments_status_idx
on public.appointments(status);

create index if not exists appointments_google_status_idx
on public.appointments(google_status);

alter table public.appointments enable row level security;

drop policy if exists "appointments authenticated read" on public.appointments;
create policy "appointments authenticated read"
on public.appointments
for select
to authenticated
using (true);

drop policy if exists "appointments authenticated write" on public.appointments;
create policy "appointments authenticated write"
on public.appointments
for all
to authenticated
using (true)
with check (true);
