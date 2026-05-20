export default function handler(_request, response) {
  return response.status(200).json({
    ok: true,
    env: {
      ghlToken: Boolean(process.env.GHL_PRIVATE_INTEGRATION_TOKEN),
      ghlLocationId: Boolean(process.env.GHL_LOCATION_ID),
      supabaseUrl: Boolean(process.env.SUPABASE_URL),
      supabaseServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      supabaseTable: process.env.SUPABASE_TABLE || "ghl_calendar_calls",
      cronSecret: Boolean(process.env.CRON_SECRET),
      dryRun: process.env.DRY_RUN ?? null,
    },
  });
}
