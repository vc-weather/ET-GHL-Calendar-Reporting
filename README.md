# ET GHL Calendar Reporting

Sync GoHighLevel calendar appointments into Supabase, keyed by the GHL appointment/event ID so changed appointments update the existing row.

## Data Safety

This integration is intentionally read-only against GoHighLevel. It only sends `GET` requests to GHL and never creates, updates, deletes, tags, or mutates GHL records. The only write operation is the Supabase upsert into `ghl_calendar_calls`.

## What It Stores

- Date call was booked: `call_booked_at`
- Date of call: `call_start_at`
- Lead first/last/email: `lead_first_name`, `lead_last_name`, `lead_email`
- Calendar: `ghl_calendar_id`, `calendar_name`
- Owner/closer: `owner_user_id`, `owner_name`, `owner_email`
- Lead score from contact: `lead_score`
- Ad ID from contact: `ad_id`
- Central reporting fields: `call_booked_at_central`, `call_start_at_central`, `call_end_at_central`, `call_start_date_central`
- Full source payloads: `raw_event`, `raw_contact`

## Setup

1. Run [supabase/001_create_ghl_calendar_calls.sql](supabase/001_create_ghl_calendar_calls.sql) in the existing Supabase project. If you already created the table before Central-time columns were added, also run [supabase/002_add_central_time_columns.sql](supabase/002_add_central_time_columns.sql).
2. Copy `.env.example` to `.env` locally, or add the same keys in Vercel project environment variables.
3. Set `GHL_PRIVATE_INTEGRATION_TOKEN`, `GHL_LOCATION_ID`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`.
4. If the custom field names are different in GHL, set `GHL_LEAD_SCORE_FIELDS` and `GHL_AD_ID_FIELDS` to comma-separated field IDs, keys, or labels. The defaults include `Lead Score` and `Meta Ad ID`.
5. `GHL_COMPANY_ID` is optional. It is only used to enrich owner IDs into user names/emails. Without it, the sync still stores `owner_user_id`.

## Environment Variables

Required:

- `GHL_PRIVATE_INTEGRATION_TOKEN`
- `GHL_LOCATION_ID`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended for Vercel:

- `CRON_SECRET`
- `DRY_RUN=false`

Never commit `.env`. This repo includes `.gitignore` rules so local secret files stay out of Git.

## Running Locally

```bash
npm run sync:dry-run
npm run sync
```

Dry runs print a PII-light summary by default. For full raw payload inspection, set `DRY_RUN_OUTPUT=full`.

By default it syncs the last 30 days through the next 90 days. Override with:

```bash
SYNC_START_DATE=2026-01-01 SYNC_END_DATE=2026-12-31 npm run sync
```

For larger imports, the script logs contact-fetch progress and writes to Supabase in batches. You can tune `GHL_CONTACT_DELAY_MS`, `SYNC_PROGRESS_EVERY`, and `SUPABASE_BATCH_SIZE`.

## Vercel

This repo includes [api/sync-ghl-calendar-calls.mjs](api/sync-ghl-calendar-calls.mjs) and [vercel.json](vercel.json).

The configured Vercel cron runs hourly and checks yesterday through tomorrow:

```text
/api/sync-ghl-calendar-calls
```

The daily cron checks the last 7 days plus tomorrow:

```text
/api/sync-ghl-calendar-calls-daily
```

Set `CRON_SECRET` in Vercel to protect manual requests. With it set, call the endpoint with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://your-app.vercel.app/api/sync-ghl-calendar-calls"
```

For a one-off range:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://your-app.vercel.app/api/sync-ghl-calendar-calls?startDate=2026-01-01&endDate=2026-12-31"
```

Check deployment configuration without touching GHL or Supabase:

```bash
curl "https://your-app.vercel.app/api/health"
```

## GitHub Checklist

Before pushing:

```bash
npm run check
git status --short
```

Make sure `.env` is not listed. If it appears, stop and remove it from Git before pushing.

Recommended repository settings:

- Keep the repo private unless the code has been reviewed for public release.
- Add Vercel environment variables through the Vercel dashboard, not GitHub.
- Protect `main` with the included CI workflow once the repository is created.

## Sharing With Vercel

You do not need to make this repository public just to connect it to someone else's Vercel account. The safer options are:

1. Create or transfer this repository into their GitHub organization, then let their Vercel account import it.
2. Keep the repo private and install/configure the Vercel GitHub App with access to only this repository.
3. If you make it public, keep all secrets in Vercel environment variables only. The code can be public, but `.env` must never be committed.

When installing the Vercel GitHub App, choose repository-limited access instead of all repositories whenever possible.
