create extension if not exists pgcrypto;

create table if not exists public.ghl_calendar_calls (
  id uuid primary key default gen_random_uuid(),
  ghl_event_id text not null unique,
  ghl_location_id text not null,
  ghl_contact_id text,
  ghl_calendar_id text,
  calendar_name text,
  owner_user_id text,
  owner_name text,
  owner_email text,
  appointment_status text,
  call_booked_at timestamptz,
  call_start_at timestamptz,
  call_end_at timestamptz,
  call_booked_at_central timestamp without time zone,
  call_start_at_central timestamp without time zone,
  call_end_at_central timestamp without time zone,
  call_start_date_central date,
  lead_first_name text,
  lead_last_name text,
  lead_email text,
  lead_score numeric,
  ad_id text,
  raw_event jsonb not null default '{}'::jsonb,
  raw_contact jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ghl_calendar_calls_call_start_at_idx
  on public.ghl_calendar_calls (call_start_at);

create index if not exists ghl_calendar_calls_call_booked_at_idx
  on public.ghl_calendar_calls (call_booked_at);

create index if not exists ghl_calendar_calls_call_start_date_central_idx
  on public.ghl_calendar_calls (call_start_date_central);

create index if not exists ghl_calendar_calls_ghl_contact_id_idx
  on public.ghl_calendar_calls (ghl_contact_id);

create index if not exists ghl_calendar_calls_ghl_calendar_id_idx
  on public.ghl_calendar_calls (ghl_calendar_id);

create or replace function public.set_ghl_calendar_calls_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_ghl_calendar_calls_updated_at'
      and tgrelid = 'public.ghl_calendar_calls'::regclass
  ) then
    create trigger set_ghl_calendar_calls_updated_at
    before update on public.ghl_calendar_calls
    for each row
    execute function public.set_ghl_calendar_calls_updated_at();
  end if;
end;
$$;

alter table public.ghl_calendar_calls enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'ghl_calendar_calls'
      and policyname = 'Service role can manage ghl calendar calls'
  ) then
    create policy "Service role can manage ghl calendar calls"
    on public.ghl_calendar_calls
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end;
$$;
