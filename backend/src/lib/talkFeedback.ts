// Talk ratings (1-10). Stored in Person.schedule_feedback (jsonb) as
// { "<event id>": <rating> }, one key appended per answered talk (same shape the
// Menorca edition used: event key -> score).

export const TALK_TYPES = new Set(["talk", "talks", "panel"]);
export const MIN_RATING = 1;
export const MAX_RATING = 10;

export type FeedbackEvent = {
  id: string;
  title: string;
  location?: string | null;
  type: string;
  start_time: Date;
  end_time: Date;
  visible_to_contact_types?: unknown;
};

export function isTalkType(type: unknown) {
  return typeof type === "string" && TALK_TYPES.has(type.trim().toLowerCase());
}

export function isValidRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= MIN_RATING && value <= MAX_RATING;
}

// What the client may send: a rating, or { didnt_watch: true } to skip the talk. A skipped
// talk is stored as null (it counts as answered so it is not asked again, and it is ignored
// in averages).
export function parseFeedbackBody(body: unknown): { ok: true; value: number | null } | { ok: false } {
  const b = (body && typeof body === "object" ? body : {}) as { rating?: unknown; didnt_watch?: unknown };
  if (b.didnt_watch === true && b.rating === undefined) return { ok: true, value: null };
  if (b.didnt_watch === undefined && isValidRating(b.rating)) return { ok: true, value: b.rating };
  return { ok: false };
}

// schedule_feedback may be null or (legacy rows) something other than an object.
export function answeredEventIds(feedback: unknown): Set<string> {
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback)) return new Set();
  return new Set(Object.keys(feedback as Record<string, unknown>));
}

// An event can be rated once it is a talk that has already finished and the person
// is allowed to see it.
export function isRateable(event: FeedbackEvent, now: Date, isVisible: (e: FeedbackEvent) => boolean) {
  return isTalkType(event.type) && event.end_time.getTime() <= now.getTime() && isVisible(event);
}

// Talks still waiting for this person's rating, oldest first so they are asked in order.
export function pendingTalks(
  events: FeedbackEvent[],
  feedback: unknown,
  now: Date,
  isVisible: (e: FeedbackEvent) => boolean,
) {
  const answered = answeredEventIds(feedback);
  return events
    .filter((e) => isRateable(e, now, isVisible) && !answered.has(e.id))
    .sort((a, b) => a.end_time.getTime() - b.end_time.getTime() || a.start_time.getTime() - b.start_time.getTime());
}
