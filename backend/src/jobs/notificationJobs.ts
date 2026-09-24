import { prisma } from "../db.js";
import { dateKeyInTimezone } from "../lib/dateTime.js";

const PROGRAM_TIMEZONE = "America/Mexico_City";
// Reminder lead time. The job runs every 5 minutes, so an event is picked up
// on the first run once it's within this window (26–31 min before it starts).
const REMINDER_LEAD_MS = 31 * 60 * 1000;

// Off unless EVENT_REMINDERS_ENABLED=true. Until 2026-09 this job never
// delivered anything (it created rows without an id, which the uuid column
// rejected), so turning it on starts a new stream of pushes for everyone.
// EVENT_REMINDER_TYPES optionally limits it to some event types, e.g.
// "talk,activity,wellness" (empty = every type).
function reminderConfig() {
  const enabled = (process.env.EVENT_REMINDERS_ENABLED || "").trim().toLowerCase() === "true";
  const types = (process.env.EVENT_REMINDER_TYPES || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return { enabled, types };
}

function minutesBetween(a: Date, b: Date) {
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 60000));
}

function normalizeContactType(raw: unknown) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "experiencemaker" ? "experience_maker" : normalized;
}

function visibleTo(event: { visible_to_contact_types: unknown }, contactType: string) {
  const allowed = Array.isArray(event.visible_to_contact_types)
    ? event.visible_to_contact_types.map(normalizeContactType).filter(Boolean)
    : [];
  return allowed.length === 0 || allowed.includes(normalizeContactType(contactType));
}

/**
 * Create a "starts in ~30 minutes" notification per (person, upcoming event),
 * once. Only for people the event is visible to and who are on site that day
 * (no arrival/departure dates = assumed on site). Push delivery is done by the
 * regular push dispatch.
 */
export async function triggerThirtyMinuteReminders(now = new Date()) {
  const config = reminderConfig();
  if (!config.enabled) return { created: 0, checkedEvents: 0, disabled: true };

  const upcoming = await prisma.event.findMany({
    where: {
      start_time: { gt: now, lte: new Date(now.getTime() + REMINDER_LEAD_MS) },
      ...(config.types.length > 0 ? { type: { in: config.types, mode: "insensitive" as const } } : {}),
    },
    select: { id: true, title: true, start_time: true, location: true, visible_to_contact_types: true },
  });
  if (upcoming.length === 0) return { created: 0, checkedEvents: 0 };

  const [people, alreadyReminded] = await Promise.all([
    prisma.person.findMany({
      select: { id: true, contact_type: true, arrival_date: true, departure_date: true },
    }),
    // Dedupe against earlier reminders only — a campaign linked to the same
    // event shouldn't suppress the reminder.
    prisma.notification.findMany({
      where: { event_id: { in: upcoming.map((e) => e.id) }, campaignRecipients: { none: {} } },
      select: { user_id: true, event_id: true },
    }),
  ]);
  const done = new Set(alreadyReminded.map((n) => `${n.user_id}:${n.event_id}`));

  const rows = [];
  for (const evt of upcoming) {
    const dayKey = dateKeyInTimezone(evt.start_time, PROGRAM_TIMEZONE) || "";
    const message = `${evt.title} starts in ~${minutesBetween(now, evt.start_time)} minutes${evt.location ? ` · ${evt.location}` : ""}`;
    for (const person of people) {
      if (done.has(`${person.id}:${evt.id}`)) continue;
      if (!visibleTo(evt, person.contact_type || "")) continue;
      const arrivalKey = dateKeyInTimezone(person.arrival_date, PROGRAM_TIMEZONE);
      const departureKey = dateKeyInTimezone(person.departure_date, PROGRAM_TIMEZONE);
      if ((arrivalKey && dayKey < arrivalKey) || (departureKey && dayKey > departureKey)) continue;
      rows.push({ id: crypto.randomUUID(), user_id: person.id, event_id: evt.id, message, sent_at: now });
    }
  }

  if (rows.length > 0) await prisma.notification.createMany({ data: rows });
  return { created: rows.length, checkedEvents: upcoming.length };
}
