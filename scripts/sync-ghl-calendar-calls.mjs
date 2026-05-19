#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

loadDotEnv();

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_CALENDAR_VERSION = "2021-04-15";
const GHL_CONTACT_VERSION = "2021-07-28";
const GHL_READONLY_METHOD = "GET";
const REPORTING_TIME_ZONE = "America/Chicago";

export async function runSync(overrides = {}) {
  const config = getConfig(overrides);
  const startMs = toMillis(config.startDate, "SYNC_START_DATE");
  const endMs = toMillis(config.endDate, "SYNC_END_DATE");

  console.log(`Syncing GHL calls from ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`);

  const calendars = await getCalendars(config);
  const users = await getUsers(config);
  const customFieldLookup = await getCustomFieldLookup(config);
  const events = (await getEvents(config, calendars, startMs, endMs))
    .filter((event) => eventStartsInsideRange(event, startMs, endMs));
  const appointments = events.filter((event) => getEventId(event) && getContactId(event));
  const contactIds = [...new Set(appointments.map(getContactId).filter(Boolean))];

  console.log(`Found ${events.length} event(s), ${appointments.length} appointment(s), ${contactIds.length} unique contact(s).`);

  const contactsById = await getContactsById(config, contactIds);

  const rows = appointments.map((event) => {
    const contact = contactsById.get(getContactId(event)) ?? {};
    const calendarId = pickFirst(event, ["calendarId", "calendar.id"]);
    const ownerUserId = pickFirst(event, ["assignedUserId", "userId", "ownerId", "assignedTo"]);
    const calendar = calendars.find((item) => item.id === calendarId) ?? {};
    const owner = users.get(ownerUserId) ?? {};

    return {
      ghl_event_id: getEventId(event),
      ghl_location_id: config.locationId,
      ghl_contact_id: getContactId(event),
      ghl_calendar_id: calendarId ?? null,
      calendar_name: pickFirst(event, ["calendarName", "calendar.name"]) ?? calendar.name ?? calendar.title ?? null,
      owner_user_id: ownerUserId ?? null,
      owner_name: pickFirst(event, ["assignedUserName", "userName", "ownerName"]) ?? fullName(owner) ?? null,
      owner_email: pickFirst(event, ["assignedUserEmail", "userEmail", "ownerEmail"]) ?? owner.email ?? null,
      appointment_status: pickFirst(event, ["appointmentStatus", "status"]) ?? null,
      call_booked_at: normalizeTimestamp(pickFirst(event, ["dateAdded", "createdAt", "created_at", "dateCreated"])),
      call_start_at: normalizeTimestamp(pickFirst(event, ["startTime", "start", "startDate"])),
      call_end_at: normalizeTimestamp(pickFirst(event, ["endTime", "end", "endDate"])),
      call_booked_at_central: centralTimestamp(pickFirst(event, ["dateAdded", "createdAt", "created_at", "dateCreated"])),
      call_start_at_central: centralTimestamp(pickFirst(event, ["startTime", "start", "startDate"])),
      call_end_at_central: centralTimestamp(pickFirst(event, ["endTime", "end", "endDate"])),
      call_start_date_central: centralDate(pickFirst(event, ["startTime", "start", "startDate"])),
      lead_first_name: pickFirst(contact, ["firstName", "first_name"]) ?? null,
      lead_last_name: pickFirst(contact, ["lastName", "last_name"]) ?? null,
      lead_email: pickFirst(contact, ["email"]) ?? null,
      lead_score: toNumber(getContactField(contact, config.leadScoreFields, customFieldLookup)),
      ad_id: stringifyNullable(
        getContactField(contact, config.adIdFields, customFieldLookup) ??
          pickFirst(contact, ["lastAttributionSource.adId", "attributionSource.adId"]),
      ),
      raw_event: event,
      raw_contact: contact,
      last_synced_at: new Date().toISOString(),
    };
  });

  if (config.dryRun) {
    if (config.dryRunOutput === "full") {
      console.log(JSON.stringify(rows, null, 2));
    } else {
      console.log(JSON.stringify(summarizeDryRun(rows), null, 2));
    }
    console.log(`Dry run complete. ${rows.length} row(s) prepared; nothing written to Supabase.`);
  } else if (rows.length > 0) {
    await upsertRows(config, rows);
    console.log(`Upserted ${rows.length} row(s) into ${config.supabaseTable}.`);
  } else {
    console.log("No matching appointment rows found.");
  }

  return {
    rowsPrepared: rows.length,
    eventsFound: events.length,
    appointmentsFound: appointments.length,
    dryRun: config.dryRun,
    startDate: new Date(startMs).toISOString(),
    endDate: new Date(endMs).toISOString(),
  };
}

if (isCliRun()) {
  await runSync();
}

function getConfig(overrides) {
  const dryRun = overrides.dryRun ?? boolEnv("DRY_RUN");

  return {
    ghlToken: overrides.ghlToken ?? requiredEnv("GHL_PRIVATE_INTEGRATION_TOKEN"),
    locationId: overrides.locationId ?? requiredEnv("GHL_LOCATION_ID"),
    calendarIds: overrides.calendarIds ?? listEnv("GHL_CALENDAR_IDS"),
    groupId: overrides.groupId ?? optionalEnv("GHL_GROUP_ID"),
    userId: overrides.userId ?? optionalEnv("GHL_USER_ID"),
    companyId: overrides.companyId ?? optionalEnv("GHL_COMPANY_ID"),
    startDate: overrides.startDate ?? optionalEnv("SYNC_START_DATE") ?? daysFromNow(-30),
    endDate: overrides.endDate ?? optionalEnv("SYNC_END_DATE") ?? daysFromNow(90),
    leadScoreFields: overrides.leadScoreFields ?? listEnv("GHL_LEAD_SCORE_FIELDS", ["lead_score", "Lead Score", "score"]),
    adIdFields: overrides.adIdFields ?? listEnv("GHL_AD_ID_FIELDS", ["Meta Ad ID", "ad_id", "Ad ID", "adId", "facebook_ad_id", "Facebook Ad ID"]),
    supabaseUrl: (overrides.supabaseUrl ?? envForWrite("SUPABASE_URL", dryRun)).replace(/\/$/, ""),
    supabaseServiceRoleKey: overrides.supabaseServiceRoleKey ?? envForWrite("SUPABASE_SERVICE_ROLE_KEY", dryRun),
    supabaseTable: overrides.supabaseTable ?? optionalEnv("SUPABASE_TABLE") ?? "ghl_calendar_calls",
    dryRun,
    dryRunOutput: overrides.dryRunOutput ?? optionalEnv("DRY_RUN_OUTPUT") ?? "summary",
    contactDelayMs: Number(overrides.contactDelayMs ?? optionalEnv("GHL_CONTACT_DELAY_MS") ?? 25),
    progressEvery: Number(overrides.progressEvery ?? optionalEnv("SYNC_PROGRESS_EVERY") ?? 50),
    supabaseBatchSize: Number(overrides.supabaseBatchSize ?? optionalEnv("SUPABASE_BATCH_SIZE") ?? 500),
  };
}

async function getCalendars(config) {
  if (config.calendarIds.length > 0) {
    return config.calendarIds.map((id) => ({ id }));
  }

  const response = await ghlGet(config, "/calendars/", GHL_CALENDAR_VERSION, {
    locationId: config.locationId,
    showDrafted: "true",
  });

  return asArray(response, ["calendars", "data", "items"]).map((calendar) => ({
    ...calendar,
    id: calendar.id ?? calendar._id,
  })).filter((calendar) => calendar.id);
}

async function getUsers(config) {
  if (!config.companyId) {
    return new Map();
  }

  try {
    const response = await ghlGet(config, "/users/search", "2023-02-21", {
      companyId: config.companyId,
    });

    return new Map(
      asArray(response, ["users", "data", "items"])
        .map((user) => [user.id ?? user._id, user])
        .filter(([id]) => id),
    );
  } catch (error) {
    console.warn(`Could not load users; owner names will use event payload when available. ${error.message}`);
    return new Map();
  }
}

async function getCustomFieldLookup(config) {
  try {
    const response = await ghlGet(
      config,
      `/locations/${encodeURIComponent(config.locationId)}/customFields`,
      GHL_CONTACT_VERSION,
      { model: "contact" },
    );

    const fields = asArray(response, ["customFields", "fields", "data", "items"]);
    const lookup = new Map();

    for (const field of fields) {
      const fieldId = field.id ?? field._id;
      if (!fieldId) {
        continue;
      }

      for (const alias of [
        fieldId,
        field.name,
        field.label,
        field.key,
        field.fieldKey,
      ]) {
        if (alias) {
          lookup.set(String(alias).toLowerCase(), fieldId);
        }
      }
    }

    return lookup;
  } catch (error) {
    console.warn(`Could not load custom field metadata; custom fields will match only by id/key from contact payload. ${error.message}`);
    return new Map();
  }
}

async function getEvents(config, calendars, startMs, endMs) {
  const scopes = [];

  if (config.groupId) {
    scopes.push({ groupId: config.groupId });
  }

  if (config.userId) {
    scopes.push({ userId: config.userId });
  }

  if (scopes.length === 0) {
    scopes.push(...calendars.map((calendar) => ({ calendarId: calendar.id })));
  }

  const seen = new Map();

  for (const scope of scopes) {
    const response = await ghlGet(config, "/calendars/events", GHL_CALENDAR_VERSION, {
      locationId: config.locationId,
      startTime: String(startMs),
      endTime: String(endMs),
      ...scope,
    });

    for (const event of asArray(response, ["events", "appointments", "data", "items"])) {
      const eventId = getEventId(event);
      if (eventId) {
        seen.set(eventId, event);
      }
    }
  }

  return [...seen.values()];
}

async function getContactsById(config, contactIds) {
  const contacts = new Map();

  for (const [index, contactId] of contactIds.entries()) {
    try {
      const response = await ghlGet(config, `/contacts/${encodeURIComponent(contactId)}`, GHL_CONTACT_VERSION);
      const contact = response.contact ?? response;
      contacts.set(contactId, contact);
      if ((index + 1) % config.progressEvery === 0 || index + 1 === contactIds.length) {
        console.log(`Fetched ${index + 1}/${contactIds.length} contact(s).`);
      }
      await wait(config.contactDelayMs);
    } catch (error) {
      console.warn(`Could not fetch contact ${contactId}: ${error.message}`);
    }
  }

  return contacts;
}

async function upsertRows(config, rows) {
  const endpoint = `${config.supabaseUrl}/rest/v1/${encodeURIComponent(config.supabaseTable)}?on_conflict=ghl_event_id`;

  for (let index = 0; index < rows.length; index += config.supabaseBatchSize) {
    const batch = rows.slice(index, index + config.supabaseBatchSize);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: config.supabaseServiceRoleKey,
        Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(`Supabase upsert failed (${response.status}): ${await response.text()}`);
    }

    console.log(`Upserted ${Math.min(index + batch.length, rows.length)}/${rows.length} row(s) into Supabase.`);
  }
}

async function ghlGet(config, path, version, query = {}) {
  const url = new URL(path, GHL_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    method: GHL_READONLY_METHOD,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${config.ghlToken}`,
      Version: version,
    },
  });

  if (!response.ok) {
    throw new Error(`GHL GET ${url.pathname} failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

function getEventId(event) {
  return pickFirst(event, ["id", "_id", "eventId", "appointmentId"]);
}

function getContactId(event) {
  return pickFirst(event, ["contactId", "contact.id", "contact._id"]);
}

function eventStartsInsideRange(event, startMs, endMs) {
  const startTime = normalizeTimestamp(pickFirst(event, ["startTime", "start", "startDate"]));
  if (!startTime) {
    return false;
  }

  const eventStartMs = new Date(startTime).getTime();
  return eventStartMs >= startMs && eventStartMs < endMs;
}

function getContactField(contact, names, customFieldLookup = new Map()) {
  for (const fieldName of names) {
    const directValue = pickFirst(contact, [fieldName]);
    if (directValue !== undefined && directValue !== null && directValue !== "") {
      return directValue;
    }
  }

  const customFields = asArray(contact.customFields ?? contact.customField ?? contact.customFieldsData);
  const wantedNames = names.map((name) => name.toLowerCase());
  const wantedIds = new Set(
    wantedNames
      .map((name) => customFieldLookup.get(name))
      .filter(Boolean)
      .map((id) => String(id).toLowerCase()),
  );

  for (const wanted of wantedNames) {
    const match = customFields.find((field) => {
      const candidates = [
        field.id,
        field.key,
        field.fieldKey,
        field.name,
        field.label,
      ].filter(Boolean).map((value) => String(value).toLowerCase());

      return candidates.includes(wanted) || candidates.some((candidate) => wantedIds.has(candidate));
    });

    if (match) {
      return match.value ?? match.field_value ?? match.fieldValue;
    }
  }

  return null;
}

function asArray(value, possibleKeys = []) {
  if (Array.isArray(value)) {
    return value;
  }

  for (const key of possibleKeys) {
    const nested = pickFirst(value, [key]);
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  return [];
}

function pickFirst(source, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, part) => current?.[part], source);
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }

  return null;
}

function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const date = typeof value === "number" || /^\d+$/.test(String(value))
    ? new Date(Number(value))
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function centralTimestamp(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) {
    return null;
  }

  return formatCentral(timestamp, true);
}

function centralDate(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) {
    return null;
  }

  return formatCentral(timestamp, false);
}

function formatCentral(value, includeTime) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REPORTING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }
      : {}),
  }).formatToParts(new Date(value));

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
  return includeTime ? `${date} ${lookup.hour}:${lookup.minute}:${lookup.second}` : date;
}

function toMillis(value, name) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be a valid date or timestamp. Received: ${value}`);
  }

  return date.getTime();
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numeric = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function stringifyNullable(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  return String(value);
}

function fullName(user) {
  return [user.firstName ?? user.first_name, user.lastName ?? user.last_name].filter(Boolean).join(" ") ||
    user.name ||
    null;
}

function daysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function loadDotEnv() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }

    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) {
      process.env[key] = valueParts.join("=").replace(/^['"]|['"]$/g, "");
    }
  }
}

function requiredEnv(name) {
  const value = optionalEnv(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function envForWrite(name, dryRun) {
  if (dryRun) {
    return optionalEnv(name) ?? "";
  }

  return requiredEnv(name);
}

function optionalEnv(name) {
  return process.env[name]?.trim();
}

function listEnv(name, fallback = []) {
  const value = optionalEnv(name);
  if (!value) {
    return fallback;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function boolEnv(name) {
  return ["1", "true", "yes", "y"].includes(String(process.env[name] ?? "").toLowerCase());
}

function isCliRun() {
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

function summarizeDryRun(rows) {
  const statusCounts = countBy(rows, "appointment_status");
  const calendarCounts = countBy(rows, "calendar_name");

  return {
    rowsPrepared: rows.length,
    statusCounts,
    calendarCounts,
    sampleRows: rows.slice(0, 5).map((row) => ({
      ghl_event_id: row.ghl_event_id,
      ghl_contact_id: row.ghl_contact_id,
      ghl_calendar_id: row.ghl_calendar_id,
      calendar_name: row.calendar_name,
      owner_user_id: row.owner_user_id,
      appointment_status: row.appointment_status,
      call_booked_at: row.call_booked_at,
      call_start_at: row.call_start_at,
      call_start_at_central: row.call_start_at_central,
      call_start_date_central: row.call_start_date_central,
      lead_email_present: Boolean(row.lead_email),
      lead_score: row.lead_score,
      ad_id: row.ad_id,
    })),
  };
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key] ?? "null";
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}
