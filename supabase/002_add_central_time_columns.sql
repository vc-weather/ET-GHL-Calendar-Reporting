alter table public.ghl_calendar_calls
  add column if not exists call_booked_at_central timestamp without time zone,
  add column if not exists call_start_at_central timestamp without time zone,
  add column if not exists call_end_at_central timestamp without time zone,
  add column if not exists call_start_date_central date;

create index if not exists ghl_calendar_calls_call_start_date_central_idx
  on public.ghl_calendar_calls (call_start_date_central);
