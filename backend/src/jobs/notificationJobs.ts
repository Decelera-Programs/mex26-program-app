import { prisma } from "../db.js";

function minutesBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 60000);
}

/**
 * Create "30 minutes before" notifications for upcoming events.
 *
 * Assumptions:
 * - Runs periodically (e.g. every minute).
 * - Writes Notification rows; delivery (push/email) can be layered later.
 * - Uses a simple dedupe rule: one reminder per (user_id, event_id) within the window.
 */
export async function triggerThirtyMinuteReminders(now = new Date()) {
  const windowStart = new Date(now.getTime() + 29 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 31 * 60 * 1000);

  const upcoming = await prisma.event.findMany({
    where: {
      start_time: {
        gte: windowStart,
        lte: windowEnd,
      },
    },
    select: {
      id: true,
      title: true,
      start_time: true,
      location: true,
    },
  });

  let created = 0;
  const audience = await prisma.person.findMany({
    select: { id: true },
    orderBy: { full_name: "asc" },
  });

  for (const evt of upcoming) {
    for (const person of audience) {
      const already = await prisma.notification.findFirst({
        where: {
          user_id: person.id,
          event_id: evt.id,
          // "sent_at" close to now is enough for dedupe in this simple job
          sent_at: { gte: new Date(now.getTime() - 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (already) continue;

      const mins = minutesBetween(now, evt.start_time);
      const message = `${evt.title} starts in ~${mins} minutes · ${evt.location}`;

      await prisma.notification.create({
        data: {
          user_id: person.id,
          event_id: evt.id,
          message,
          sent_at: now,
        },
      });

      created += 1;
    }
  }

  return { created, checkedEvents: upcoming.length };
}

