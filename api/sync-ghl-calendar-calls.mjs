import { runSync } from "../scripts/sync-ghl-calendar-calls.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET" && request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret && process.env.NODE_ENV === "production") {
    return response.status(500).json({ error: "CRON_SECRET is not configured" });
  }

  if (cronSecret && !isAuthorized(request, cronSecret)) {
    return response.status(401).json({ error: "Unauthorized" });
  }

  try {
    const syncWindow = getSyncWindow(request.query);
    const result = await runSync({
      startDate: syncWindow.startDate,
      endDate: syncWindow.endDate,
      dryRun: request.query?.dryRun === "true" ? true : undefined,
    });

    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ ok: false, error: error.message });
  }
}

function isAuthorized(request, cronSecret) {
  const authHeader = request.headers.authorization ?? "";
  const querySecret = request.query?.secret;
  return authHeader === `Bearer ${cronSecret}` || querySecret === cronSecret;
}

function getSyncWindow(query = {}) {
  if (query.startDate || query.endDate) {
    return {
      startDate: query.startDate,
      endDate: query.endDate,
    };
  }

  const daysBack = Number(query.daysBack ?? 1);
  const daysForward = Number(query.daysForward ?? 1);
  const now = new Date();

  return {
    startDate: addDays(now, -daysBack).toISOString(),
    endDate: addDays(now, daysForward).toISOString(),
  };
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}
