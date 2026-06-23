-- Phase 4A: Appointment Google Calendar sync status
-- Safe to run more than once. It does not delete or clear existing appointments.

alter table if exists public.appointments
  add column if not exists status text not null default 'scheduled',
  add column if not exists google_sync_error text,
  add column if not exists google_last_synced_at timestamptz,
  add column if not exists cancelled_at timestamptz;

create index if not exists appointments_status_idx on public.appointments(status);
create index if not exists appointments_google_status_idx on public.appointments(google_status);
