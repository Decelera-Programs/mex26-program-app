// The program runs in Mexico. Event times in the database are stored as
// "floating" wall-clock values (no timezone): whatever is typed as the
// published Mexico schedule is what every attendee sees, regardless of their
// device timezone. So event formatters below deliberately do NOT pass a
// `timeZone` option and `parseEventDate` does NOT coerce naive strings to UTC.
//
// PROGRAM_TIMEZONE is only used for "what day is it right now" style checks
// (today's schedule, on-site presence), so those flip at Mexico midnight.
export const PROGRAM_TIMEZONE = "America/Mexico_City";

function parseEventDate(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
  // Naive timestamps are treated as floating local wall-clock time (no "Z").
  // Timestamps that already carry an explicit offset are respected as-is.
  const date = new Date(normalized);
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
