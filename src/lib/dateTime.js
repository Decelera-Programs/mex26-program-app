// The program runs in Mexico and every time in the app is shown in Mexico
// time, whatever the device's timezone (the team previews from Spain).
//
// The database stores real instants (timestamptz; Prisma serializes them as
// UTC, e.g. "2026-10-10T14:00:00.000Z" = 08:00 in Mexico). The data layer
// converts event / 1:1 times into naive Mexico wall-clock strings
// ("2026-10-10T08:00:00") with `toProgramWallClock`, and every formatter and
// moment() call below reads those naive strings as-is. Anything compared
// against them ("what's on now", "next event") must use `programNow()`, which
// is the current Mexico wall clock on the same naive footing.
//
// Values that still carry a zone (campaign sent_at / scheduled_for, note
// timestamps…) are converted to Mexico time by the formatters too.
//
// Writing back (campaign scheduled_for) goes the other way with
// `programWallClockToDate`, so the backend always receives a real instant.
export const PROGRAM_TIMEZONE = "America/Mexico_City";

// First day of the program (Day 1), as a Mexico calendar date. Drives the
// Home countdown and the Moments day numbering.
export const PROGRAM_START_DATE = "2026-10-10";

/** Whole days from PROGRAM_START_DATE to a YYYY-MM-DD key (start = 0). */
export function daysSinceProgramStart(dayKey) {
  const toUtcMs = (key) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
  return Math.round((toUtcMs(String(dayKey).slice(0, 10)) - toUtcMs(PROGRAM_START_DATE)) / 86400000);
}

const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const NAIVE_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

const programPartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PROGRAM_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function programParts(date) {
  const parts = {};
  for (const { type, value } of programPartsFormatter.formatToParts(date)) parts[type] = value;
  // Some engines still print midnight as "24" even with h23.
  if (parts.hour === "24") parts.hour = "00";
  return parts;
}

/**
 * Real instant (Date, or string with Z / offset) -> naive Mexico wall-clock
 * string "YYYY-MM-DDTHH:mm:ss". Naive strings are assumed to already be
 * Mexico wall clock and are only normalized. Unparseable input is returned
 * untouched.
 */
export function toProgramWallClock(value) {
  if (value == null || value === "") return value;
  if (!(value instanceof Date)) {
    const s = String(value).trim();
    const naive = s.match(NAIVE_DATETIME);
    if (naive && !HAS_ZONE.test(s)) {
      return `${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6] || "00"}`;
    }
    value = new Date(s);
  }
  if (Number.isNaN(value.getTime())) return value;
  const p = programParts(value);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** Current Mexico wall clock, on the same naive footing as event times. */
export function programNow() {
  return new Date(toProgramWallClock(new Date()));
}

/**
 * Mexico wall-clock string ("YYYY-MM-DDTHH:mm", e.g. a datetime-local input)
 * -> the real instant, whatever the device timezone. Null if unparseable.
 */
export function programWallClockToDate(value) {
  const m = String(value || "").trim().match(NAIVE_DATETIME);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const offsetAt = (ms) => {
    const p = programParts(new Date(ms));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  // Two passes settle the offset even across a DST change.
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant);
}

function parseEventDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    // Dates here are naive wall-clock values (e.g. from programNow()).
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  // Zoned values become Mexico wall clock; naive ones are read verbatim.
  const date = new Date(toProgramWallClock(raw));
  return Number.isNaN(date.getTime()) ? null : date;
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const time24Formatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabelFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Calendar day key (YYYY-MM-DD) for "now" in the program's timezone. */
export function getTodayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PROGRAM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatTime(value) {
  const date = parseEventDate(value);
  if (!date) return "";
  return timeFormatter.format(date);
}

export function formatTime24(value) {
  const date = parseEventDate(value);
  if (!date) return "";
  return time24Formatter.format(date);
}

export function formatDayKey(value) {
  const date = parseEventDate(value);
  if (!date) return "";
  return dayKeyFormatter.format(date);
}

export function formatDayLabel(value) {
  const date = parseEventDate(value);
  if (!date) return "";
  return dayLabelFormatter.format(date);
}

export function formatShortDateTime(value) {
  const date = parseEventDate(value);
  if (!date) return "";
  return shortDateTimeFormatter.format(date);
}

export function formatRelativeTime(value, nowValue = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "";

  const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) return relativeTimeFormatter.format(diffSeconds, "second");

  const diffMinutes = Math.round(diffSeconds / 60);
  const absMinutes = Math.abs(diffMinutes);
  if (absMinutes < 60) return relativeTimeFormatter.format(diffMinutes, "minute");

  const diffHours = Math.round(diffMinutes / 60);
  const absHours = Math.abs(diffHours);
  if (absHours < 24) return relativeTimeFormatter.format(diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  return relativeTimeFormatter.format(diffDays, "day");
}
