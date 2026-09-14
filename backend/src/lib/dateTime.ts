const DEFAULT_TIMEZONE = "America/Mexico_City";

export function dateKeyInTimezone(raw: Date | string | null | undefined, timeZone = DEFAULT_TIMEZONE) {
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayDateKey(timeZone = DEFAULT_TIMEZONE) {
  return dateKeyInTimezone(new Date(), timeZone) || "";
}

// Local hour (0-23) in the given timezone. Used to gate end-of-day jobs.
export function hourInTimezone(raw: Date | string | null | undefined = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const date = raw ? (raw instanceof Date ? raw : new Date(raw)) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const n = Number.parseInt(formatted, 10);
  return Number.isFinite(n) ? ((n % 24) + 24) % 24 : null;
}
