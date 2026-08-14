import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createClient } from "@supabase/supabase-js";
import { Prisma, NotificationCampaignStatus } from "@prisma/client";
import webpush from "web-push";
import { prisma } from "./db.js";
import { triggerThirtyMinuteReminders } from "./jobs/notificationJobs.js";

const app = express();
app.use(cors());
app.use(express.json());
const SUPABASE_URL = process.env.SUPABASE_URL?.trim() ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
let VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY?.trim() ?? "";
let VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY?.trim() ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com";

let vapidMode: "configured" | "generated" = "configured";
let lastPushDispatchSummary: Record<string, unknown> | null = null;
const PUSH_RETRY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PERSON_CACHE_TTL_MS = 30_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const personResolutionCache = new Map<string, { person: any; expiresAt: number }>();
let _supabaseAdmin: ReturnType<typeof createClient> | null | undefined = undefined;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  vapidMode = "generated";
  const generated = webpush.generateVAPIDKeys();
  VAPID_PUBLIC_KEY = generated.publicKey;
  VAPID_PRIVATE_KEY = generated.privateKey;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  // eslint-disable-next-line no-console
  console.warn(
    "VAPID keys missing (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY). Generated temporary keys in-memory. Push subscriptions will break after server restarts.",
  );
}

function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}

function normalizeContactType(raw: unknown) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "experiencemaker") return "experience_maker";
  return normalized;
}

function toContactTypeArray(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const normalized = raw
    .map((value) => normalizeContactType(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function isEventVisibleForContactType(event: { visible_to_contact_types?: unknown }, contactType: string) {
  const allowedContactTypes = toContactTypeArray(event.visible_to_contact_types);
  if (allowedContactTypes.length === 0) return true;
  if (!contactType) return false;
  return allowedContactTypes.includes(normalizeContactType(contactType));
}

const AUDIENCE_TIMEZONE = "Europe/Madrid";
const ADMIN_EMAIL_ALLOWLIST = (process.env.CAMPAIGN_ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_API_KEY = (process.env.CAMPAIGN_ADMIN_API_KEY || "").trim();
const JOBS_API_KEY = (process.env.JOBS_API_KEY || "").trim();
const ONE_ON_ONE_AUDIO_BUCKET = (process.env.SUPABASE_AUDIO_BUCKET || "one-on-ones-audio").trim();
const ONE_ON_ONE_AUDIO_SIGNED_URL_TTL_SEC = 60 * 60;
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_TRANSCRIPTION_MODEL = (process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe").trim();
const OPENAI_MATCHING_MODEL = (process.env.OPENAI_MATCHING_MODEL || "gpt-4o-mini").trim();

// Founder<->Experience Maker daily matching. Own timezone constant (not AUDIENCE_TIMEZONE,
// which is hardcoded to Madrid for a Mexico program - a preexisting issue out of scope here).
const MATCHING_TIMEZONE = "America/Mexico_City";
const MATCH_CANDIDATE_POOL_SIZE = 10;
const MATCH_WEIGHT_CHALLENGE = 3;
const MATCH_WEIGHT_DIRECT_TAG = 1;

// Maps a founder's worst-rated challenge sections to expertise_tags likely to help with them.
// Hand-tuned against the real expertise_tags vocabulary in production; edit freely if matches feel off.
const MATCH_SECTION_TO_TAGS: Record<string, string[]> = {
  sales_growth: [
    "Sales / Growth", "Fundraising", "GTM", "Revenue", "Partnerships", "Customer Success",
    "E-commerce", "Marketplace", "B2B", "B2C", "SMBs", "VC", "Early Stage Startups Investor",
  ],
  team_culture: [
    "Culture", "Leadership", "People and Talent", "Founder Mindset", "Full Remote Team",
    "Operations & Growth", "Board Member", "Advisor", "Strategy",
  ],
  product_technology: [
    "Product", "AI", "Big data", "Tech Background", "Platform thinking",
    "Mobile applications", "Enterprise applications", "Deeptech",
  ],
  marketing_communication: ["Digital marketing", "Inbound marketing", "Communication", "Brand"],
};

const matchChoiceSchema = z
  .object({
    selected_em_id: z.string().min(1),
    reason: z.string().min(1).max(500),
  })
  .strict();

const campaignFiltersSchema = z
  .object({
    contact_types: z.array(z.string().min(1)).optional(),
    startup_ids: z.array(z.string().min(1)).optional(),
    on_island_today: z.boolean().optional(),
  })
  .strict();

const campaignCreateSchema = z
  .object({
    title: z.string().min(1),
    message: z.string().min(1),
    event_id: z.string().min(1).nullable().optional(),
    filters: campaignFiltersSchema,
    mode: z.enum(["draft", "send_now", "schedule"]).default("draft"),
    scheduled_for: z.string().datetime().nullable().optional(),
  })
  .strict();

function dateKeyInTimezone(raw: Date | string | null | undefined, timeZone = AUDIENCE_TIMEZONE) {
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

function todayDateKey(timeZone = AUDIENCE_TIMEZONE) {
  return dateKeyInTimezone(new Date(), timeZone) || "";
}

const personSafeSelect = {
  id: true,
  email: true,
  user_id: true,
  full_name: true,
  bio: true,
  tagline: true,
  photo_url: true,
  linkedin_url: true,
  company_name: true,
  contact_type: true,
  arrival_date: true,
  departure_date: true,
  expertise_tags: true,
  schedule_feedback: true,
  daily_checkin: true,
  startup_id: true,
  post_program_expectations: true,
  fun_fact: true,
  createdAt: true,
  updatedAt: true,
  startup: true,
} as const;

async function findPersonByEmail(rawEmail: string) {
  const normalizedEmail = normalizeEmail(rawEmail);
  const direct = await prisma.person.findFirst({
    where: {
      email: {
        equals: normalizedEmail,
        mode: "insensitive",
      },
    },
    select: personSafeSelect,
  });
  if (direct) return direct;

  // Fallback for legacy rows that may contain extra spaces.
  const candidates = await prisma.person.findMany({
    where: { email: { not: null } },
    select: personSafeSelect,
  });
  return candidates.find((p) => (p.email ? normalizeEmail(p.email) === normalizedEmail : false)) || null;
}

async function resolvePersonFromAuth(auth: { sub: string; email: string }) {
  const hit = personResolutionCache.get(auth.sub);
  if (hit && Date.now() < hit.expiresAt) return hit.person;

  const byUserId = await prisma.person.findFirst({
    where: { user_id: auth.sub },
    select: personSafeSelect,
  });
  if (byUserId) {
    personResolutionCache.set(auth.sub, { person: byUserId, expiresAt: Date.now() + PERSON_CACHE_TTL_MS });
    return byUserId;
  }
  const byEmail = await findPersonByEmail(auth.email);
  if (!byEmail) return null;
  if (!byEmail.user_id) {
    await prisma.person.update({
      where: { id: byEmail.id },
      data: { user_id: auth.sub },
    });
    byEmail.user_id = auth.sub;
  }
  personResolutionCache.set(auth.sub, { person: byEmail, expiresAt: Date.now() + PERSON_CACHE_TTL_MS });
  return byEmail;
}

async function resolveAccessibleOneOnOneForPerson(
  oneOnOneId: string,
  person: { id: string; contact_type: string | null; startup_id: string | null },
) {
  const isEM = normalizeContactType(person.contact_type) === "experience_maker";
  if (!isEM && !person.startup_id) return null;
  const whereClause = isEM
    ? { id: oneOnOneId, em_id: person.id }
    : { id: oneOnOneId, startup_id: person.startup_id! };

  return prisma.oneOnOne.findFirst({
    where: whereClause,
    select: {
      id: true,
      startup_id: true,
      em_id: true,
      start_time: true,
      end_time: true,
      location: true,
      notes: true,
      active_audio_url: true,
      active_audio_storage_path: true,
      active_audio_duration_sec: true,
      active_audio_uploaded_at: true,
      active_audio_status: true,
      audio_transcript: true,
      audio_transcript_updated_at: true,
    },
  });
}

async function dispatchDuePushNotifications(now = new Date()) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { processed: 0, pushed: 0 };

  const dueNotifications = await prisma.notification.findMany({
    where: {
      sent_at: { lte: now },
      pushed_at: null,
    },
    include: {
      user: {
        include: {
          pushSubscriptions: true,
        },
      },
      campaignRecipients: {
        include: { campaign: { select: { title: true } } },
        take: 1,
      },
      match: { select: { founder_id: true, em_id: true } },
    },
    take: 100,
    orderBy: { sent_at: "asc" },
  });

  let pushed = 0;
  let notificationsWithSubscriptions = 0;
  let retriedLater = 0;
  let expiredWithoutPush = 0;
  for (const notification of dueNotifications) {
    const subscriptions = notification.user?.pushSubscriptions ?? [];
    let pushedThisNotification = 0;
    if (subscriptions.length > 0) {
      notificationsWithSubscriptions += 1;
    }
    const campaignTitle = notification.campaignRecipients?.[0]?.campaign?.title;
    const counterpartId = notification.match
      ? notification.match.founder_id === notification.user_id
        ? notification.match.em_id
        : notification.match.founder_id
      : null;
    const payload = JSON.stringify({
      title: campaignTitle || "Menorca Program",
      body: notification.message,
      eventId: notification.event_id ?? null,
      personId: counterpartId,
      notificationId: notification.id,
      sentAt: notification.sent_at,
    });

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          payload,
          { urgency: "high" },
        );
        pushed += 1;
        pushedThisNotification += 1;
      } catch (error) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.deleteMany({
            where: { endpoint: subscription.endpoint },
          });
        }
      }
    }

    if (pushedThisNotification > 0) {
      await prisma.notification.update({
        where: { id: notification.id },
        data: { pushed_at: now },
      });
      continue;
    }

    const ageMs = now.getTime() - new Date(notification.sent_at).getTime();
    if (ageMs >= PUSH_RETRY_MAX_AGE_MS) {
      // Stop retrying very old notifications that could not be pushed.
      await prisma.notification.update({
        where: { id: notification.id },
        data: { pushed_at: now },
      });
      expiredWithoutPush += 1;
    } else {
      // Keep pushed_at null so next dispatch retries (helps Android/background cases).
      retriedLater += 1;
    }
  }

  return {
    processed: dueNotifications.length,
    pushed,
    notificationsWithSubscriptions,
    retriedLater,
    expiredWithoutPush,
    dueNotificationIds: dueNotifications.map((notification) => notification.id),
  };
}

async function runPushDispatch(reason: string) {
  const startedAt = new Date();
  try {
    const result = await dispatchDuePushNotifications(startedAt);
    lastPushDispatchSummary = {
      ok: true,
      reason,
      startedAt,
      ...result,
    };
    if ((result.processed || 0) > 0) {
      // eslint-disable-next-line no-console
      console.log(`Push dispatch [${reason}]`, lastPushDispatchSummary);
    }
    return result;
  } catch (error) {
    lastPushDispatchSummary = {
      ok: false,
      reason,
      startedAt,
      error: error instanceof Error ? error.message : "unknown error",
    };
    throw error;
  }
}

async function runScheduledCampaignDispatch(now = new Date()) {
  const dueCampaigns = await prisma.notificationCampaign.findMany({
    where: {
      status: "scheduled",
      scheduled_for: { lte: now },
    },
    orderBy: { scheduled_for: "asc" },
    take: 20,
  });

  const results: Array<{ campaignId: string; ok: boolean; error?: string }> = [];
  for (const campaign of dueCampaigns) {
    try {
      await dispatchCampaign(campaign.id, "scheduler");
      results.push({ campaignId: campaign.id, ok: true });
    } catch (error) {
      results.push({
        campaignId: campaign.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown scheduler error",
      });
    }
  }
  return {
    checkedAt: now,
    dueCount: dueCampaigns.length,
    results,
  };
}

function getSupabaseAdmin() {
  if (_supabaseAdmin !== undefined) return _supabaseAdmin;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    _supabaseAdmin = null;
    return null;
  }
  _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _supabaseAdmin;
}

async function createOneOnOneAudioSignedUrl(storagePath: string | null | undefined) {
  if (!storagePath) return "";
  const admin = getSupabaseAdmin();
  if (!admin) return "";
  const { data, error } = await admin.storage
    .from(ONE_ON_ONE_AUDIO_BUCKET)
    .createSignedUrl(storagePath, ONE_ON_ONE_AUDIO_SIGNED_URL_TTL_SEC);
  if (error) return "";
  return data?.signedUrl || "";
}

async function transcribeAudioBuffer(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  fileName = "meeting-audio.webm",
) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in backend env");
  }

  const form = new FormData();
  form.append("model", OPENAI_TRANSCRIPTION_MODEL);
  form.append("file", new Blob([audioBuffer], { type: mimeType || "audio/webm" }), fileName);
  form.append("response_format", "json");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI transcription request failed");
  }

  const text = String(payload?.text || "").trim();
  if (!text) {
    throw new Error("Empty transcription result");
  }
  return text;
}

async function rebuildOneOnOneTranscript(oneOnOneId: string) {
  const transcribedSubmissions = await prisma.oneOnOneAudioSubmission.findMany({
    where: {
      one_on_one_id: oneOnOneId,
      status: "uploaded",
      transcript_text: { not: null },
    },
    select: {
      transcript_text: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const transcript = transcribedSubmissions
    .map((entry) => (entry.transcript_text || "").trim())
    .filter(Boolean)
    .join("\n\n");

  await prisma.oneOnOne.update({
    where: { id: oneOnOneId },
    data: {
      audio_transcript: transcript || null,
      audio_transcript_updated_at: new Date(),
    },
  });

  return transcript;
}

async function runOneOnOneTranscriptionJob(limit = 10) {
  const pending = await prisma.oneOnOneAudioSubmission.findMany({
    where: {
      status: "uploaded",
      storage_path: { not: null },
      OR: [{ transcript_text: null }, { transcript_text: "" }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (pending.length === 0) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      updated_one_on_ones: 0,
    };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase admin client is not configured");
  }

  let succeeded = 0;
  let failed = 0;
  const impactedOneOnOnes = new Set<string>();

  for (const submission of pending) {
    const storagePath = (submission.storage_path || "").trim();
    if (!storagePath) continue;

    try {
      const { data, error } = await admin.storage.from(ONE_ON_ONE_AUDIO_BUCKET).download(storagePath);
      if (error || !data) {
        throw new Error(error?.message || "Failed to download audio from Supabase Storage");
      }

      const mimeType = data.type || submission.mime_type || "audio/webm";
      const audioBuffer = await data.arrayBuffer();
      const transcript = await transcribeAudioBuffer(audioBuffer, mimeType, `one-on-one-${submission.id}.webm`);

      await prisma.oneOnOneAudioSubmission.update({
        where: { id: submission.id },
        data: {
          transcript_text: transcript,
          transcript_error: null,
          transcribed_at: new Date(),
        },
      });
      impactedOneOnOnes.add(submission.one_on_one_id);
      succeeded += 1;
    } catch (error) {
      await prisma.oneOnOneAudioSubmission.update({
        where: { id: submission.id },
        data: {
          transcript_error: error instanceof Error ? error.message : "Unknown transcription error",
        },
      });
      failed += 1;
    }
  }

  for (const oneOnOneId of impactedOneOnOnes) {
    await rebuildOneOnOneTranscript(oneOnOneId);
  }

  return {
    processed: pending.length,
    succeeded,
    failed,
    updated_one_on_ones: impactedOneOnOnes.size,
  };
}
async function runTeamNoteTranscriptionJob(limit = 10) {
  const pending = await prisma.teamAudioNote.findMany({
    where: {
      status: "uploaded",
      storage_path: { not: null },
      OR: [{ transcript_text: null }, { transcript_text: "" }],
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  if (pending.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase admin client is not configured");
  }

  let succeeded = 0;
  let failed = 0;

  for (const note of pending) {
    const storagePath = (note.storage_path || "").trim();
    if (!storagePath) continue;

    try {
      const { data, error } = await admin.storage.from(ONE_ON_ONE_AUDIO_BUCKET).download(storagePath);
      if (error || !data) {
        throw new Error(error?.message || "Failed to download audio from Supabase Storage");
      }

      const mimeType = data.type || note.mime_type || "audio/webm";
      const audioBuffer = await data.arrayBuffer();
      const transcript = await transcribeAudioBuffer(audioBuffer, mimeType, `team-note-${note.id}.webm`);

      await prisma.teamAudioNote.update({
        where: { id: note.id },
        data: {
          transcript_text: transcript,
          transcript_error: null,
          transcribed_at: new Date(),
          status: "transcribed",
        },
      });
      succeeded += 1;
    } catch (error) {
      await prisma.teamAudioNote.update({
        where: { id: note.id },
        data: {
          transcript_error: error instanceof Error ? error.message : "Unknown transcription error",
        },
      });
      failed += 1;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

function parseRatingSeverity(ratingText: unknown): number | null {
  if (typeof ratingText !== "string") return null;
  const match = ratingText.match(/^(\d+)/);
  return match ? Number(match[1]) : null;
}

function hasMeaningfulExpertiseTags(tags: unknown): tags is string[] {
  return Array.isArray(tags) && tags.some((t) => typeof t === "string" && t.trim());
}

function hasMeaningfulChallenges(challenges: unknown): boolean {
  if (!challenges || typeof challenges !== "object") return false;
  const sections = (challenges as { sections?: unknown }).sections;
  if (!sections || typeof sections !== "object") return false;
  return Object.values(sections as Record<string, unknown>).some((section) => {
    const ratings = (section as { ratings?: unknown } | null)?.ratings;
    return ratings && typeof ratings === "object" && Object.keys(ratings).length > 0;
  });
}

function topChallengeSections(challenges: unknown): Array<{ section: string; avgSeverity: number }> {
  const sections =
    (challenges as { sections?: Record<string, { ratings?: Record<string, unknown> } | null> } | null)?.sections || {};
  const scored = Object.entries(sections)
    .map(([section, data]) => {
      const values = Object.values(data?.ratings || {})
        .map(parseRatingSeverity)
        .filter((v): v is number => v != null);
      if (values.length === 0) return null;
      const avgSeverity = values.reduce((a, b) => a + b, 0) / values.length;
      return { section, avgSeverity };
    })
    .filter((v): v is { section: string; avgSeverity: number } => v != null)
    .sort((a, b) => b.avgSeverity - a.avgSeverity);

  const priority = scored.filter((s) => s.avgSeverity >= 3).slice(0, 2);
  return priority.length > 0 ? priority : scored.slice(0, 1);
}

function tagsFromChallengeSections(challenges: unknown): string[] {
  const tags = new Set<string>();
  for (const { section } of topChallengeSections(challenges)) {
    for (const tag of MATCH_SECTION_TO_TAGS[section] || []) tags.add(tag);
  }
  return Array.from(tags);
}

type MatchCandidatePerson = {
  id: string;
  full_name: string;
  tagline: string | null;
  photo_url: string | null;
  contact_type: string | null;
  company_name: string | null;
  expertise_tags: unknown;
  startup_id: string | null;
  arrival_date: Date | null;
  departure_date: Date | null;
  startup: { id: string; name: string; challenges: unknown } | null;
};

async function loadMatchingPoolForToday() {
  const todayKey = todayDateKey(MATCHING_TIMEZONE);
  const people = await prisma.person.findMany({
    where: { contact_type: { in: ["founder", "experience_maker"] } },
    select: {
      id: true,
      full_name: true,
      tagline: true,
      photo_url: true,
      contact_type: true,
      company_name: true,
      expertise_tags: true,
      startup_id: true,
      arrival_date: true,
      departure_date: true,
      startup: { select: { id: true, name: true, challenges: true } },
    },
  });

  const presentToday = people.filter((p) => {
    const arrivalKey = dateKeyInTimezone(p.arrival_date, MATCHING_TIMEZONE);
    const departureKey = dateKeyInTimezone(p.departure_date, MATCHING_TIMEZONE);
    return (!arrivalKey || arrivalKey <= todayKey) && (!departureKey || departureKey >= todayKey);
  });

  const alreadyMatchedToday = new Set(
    (
      await prisma.match.findMany({
        where: { match_date: new Date(`${todayKey}T00:00:00.000Z`) },
        select: { founder_id: true },
      })
    ).map((m) => m.founder_id),
  );

  const founders = presentToday.filter(
    (p) =>
      p.contact_type === "founder" &&
      !alreadyMatchedToday.has(p.id) &&
      (hasMeaningfulExpertiseTags(p.expertise_tags) || hasMeaningfulChallenges(p.startup?.challenges)),
  );
  const ems = presentToday.filter(
    (p) => p.contact_type === "experience_maker" && hasMeaningfulExpertiseTags(p.expertise_tags),
  );

  return { founders, ems, todayKey };
}

function scoreCandidates(
  founder: MatchCandidatePerson,
  ems: MatchCandidatePerson[],
  excludedPairs: Set<string>,
) {
  const founderTags = hasMeaningfulExpertiseTags(founder.expertise_tags) ? founder.expertise_tags : [];
  const challengeTags = tagsFromChallengeSections(founder.startup?.challenges);

  return ems
    .filter((em) => !excludedPairs.has(`${founder.id}:${em.id}`))
    .map((em) => {
      const emTags = hasMeaningfulExpertiseTags(em.expertise_tags) ? em.expertise_tags : [];
      const challengeOverlap = emTags.filter((t) => challengeTags.includes(t)).length;
      const directOverlap = emTags.filter((t) => founderTags.includes(t)).length;
      const score = challengeOverlap * MATCH_WEIGHT_CHALLENGE + directOverlap * MATCH_WEIGHT_DIRECT_TAG;
      return { em, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.em.id.localeCompare(b.em.id))
    .slice(0, MATCH_CANDIDATE_POOL_SIZE);
}

async function pickMatchWithOpenAI(
  founder: MatchCandidatePerson,
  shortlist: Array<{ em: MatchCandidatePerson; score: number }>,
): Promise<{ selected_em_id: string; reason: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in backend env");
  }

  const challenges = founder.startup?.challenges as
    | { deep_dive?: { challenge_name?: string; expertise_wanted?: string } }
    | undefined;
  const founderContext = {
    id: founder.id,
    full_name: founder.full_name,
    startup_name: founder.startup?.name || null,
    expertise_tags: founder.expertise_tags,
    priority_challenges: topChallengeSections(founder.startup?.challenges),
    challenge_name: challenges?.deep_dive?.challenge_name || null,
    expertise_wanted: challenges?.deep_dive?.expertise_wanted || null,
  };
  const candidates = shortlist.map(({ em, score }) => ({
    id: em.id,
    full_name: em.full_name,
    tagline: em.tagline,
    company_name: em.company_name,
    expertise_tags: em.expertise_tags,
    score,
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MATCHING_MODEL,
        temperature: 0.4,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Eres un asistente de matchmaking para el programa Decelera Mexico 2026. " +
              "Se te dara un founder con sus retos actuales y una lista corta (shortlist) de experience makers " +
              "(mentores) candidatos. Debes elegir EXACTAMENTE UNO de los ids de la shortlist (nunca inventes un id " +
              "que no este en la lista) y explicar en maximo 280 caracteres, citando datos concretos (tags de " +
              "expertise y/o el area de reto especifica), por que tiene sentido esa combinacion. Responde SOLO un " +
              'JSON con este formato exacto: {"selected_em_id": string, "reason": string}.',
          },
          { role: "user", content: JSON.stringify({ founder: founderContext, candidates }) },
        ],
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload?.error?.message || "OpenAI matching request failed");
  }
  const raw = payload?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Empty OpenAI matching response");
  }
  const parsed = matchChoiceSchema.parse(JSON.parse(raw));
  if (!shortlist.some((c) => c.em.id === parsed.selected_em_id)) {
    throw new Error("OpenAI selected an id outside the shortlist");
  }
  return parsed;
}

function fallbackMatchReason(founder: MatchCandidatePerson, em: MatchCandidatePerson) {
  const founderTags = hasMeaningfulExpertiseTags(founder.expertise_tags) ? founder.expertise_tags : [];
  const emTags = hasMeaningfulExpertiseTags(em.expertise_tags) ? em.expertise_tags : [];
  const challengeTags = tagsFromChallengeSections(founder.startup?.challenges);
  const shared = Array.from(
    new Set([
      ...emTags.filter((t) => challengeTags.includes(t)),
      ...emTags.filter((t) => founderTags.includes(t)),
    ]),
  );
  return shared.length > 0
    ? `Emparejados por afinidad en: ${shared.join(", ")}.`
    : "Emparejados por afinidad en areas de expertise complementarias.";
}

async function runDailyMatchingJob(limit = 50) {
  const { founders, ems, todayKey } = await loadMatchingPoolForToday();
  const foundersToProcess = founders.slice(0, limit);

  if (foundersToProcess.length === 0 || ems.length === 0) {
    return { processed: 0, matched: 0, skipped_no_candidates: 0, failed: 0 };
  }

  const existingPairs = new Set(
    (await prisma.match.findMany({ select: { founder_id: true, em_id: true } })).map(
      (m) => `${m.founder_id}:${m.em_id}`,
    ),
  );

  let matched = 0;
  let skippedNoCandidates = 0;
  let failed = 0;
  const matchDate = new Date(`${todayKey}T00:00:00.000Z`);

  for (const founder of foundersToProcess) {
    try {
      const shortlist = scoreCandidates(founder, ems, existingPairs);
      if (shortlist.length === 0) {
        skippedNoCandidates += 1;
        continue;
      }

      let selectedEmId = shortlist[0].em.id;
      let reasonText = fallbackMatchReason(founder, shortlist[0].em);
      let selectionMethod = "fallback_top_score";
      let aiRawResponse: unknown = null;

      try {
        const aiChoice = await pickMatchWithOpenAI(founder, shortlist);
        selectedEmId = aiChoice.selected_em_id;
        reasonText = aiChoice.reason;
        selectionMethod = "ai";
        aiRawResponse = aiChoice;
      } catch {
        // Keep the deterministic top-score fallback already assigned above.
      }

      const selected = shortlist.find((c) => c.em.id === selectedEmId) || shortlist[0];

      const createdMatch = await prisma.match.create({
        data: {
          match_date: matchDate,
          founder_id: founder.id,
          em_id: selected.em.id,
          startup_id: founder.startup_id,
          score: selected.score,
          candidate_pool: shortlist.map((c) => ({ em_id: c.em.id, score: c.score })) as Prisma.InputJsonValue,
          selection_method: selectionMethod,
          reason_text: reasonText,
          ai_raw_response: aiRawResponse as Prisma.InputJsonValue,
        },
      });

      await prisma.notification.createMany({
        data: [
          {
            id: crypto.randomUUID(),
            user_id: founder.id,
            message: reasonText,
            sent_at: new Date(),
            match_id: createdMatch.id,
          },
          {
            id: crypto.randomUUID(),
            user_id: selected.em.id,
            message: reasonText,
            sent_at: new Date(),
            match_id: createdMatch.id,
          },
        ],
      });

      existingPairs.add(`${founder.id}:${selected.em.id}`);
      matched += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    processed: foundersToProcess.length,
    matched,
    skipped_no_candidates: skippedNoCandidates,
    failed,
  };
}

const JWKS = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

type AuthenticatedRequest = Request & {
  auth?: {
    sub: string;
    email: string;
  };
};

function looksLikeUuid(value: string | null | undefined) {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function isMissingTableError(error: unknown, modelName: string) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; meta?: { modelName?: string } };
  return maybe.code === "P2021" && maybe.meta?.modelName === modelName;
}

function parseScheduleDayKey(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    dayKey: raw,
    dayNumber: parsed.getUTCDate(),
  };
}

function parseDateKey(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return { dateKey: raw, date: parsed };
}

function toScheduleFeedbackObject(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([key, value]) =>
        Boolean(key) &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 5,
    ),
  ) as Record<string, number>;
}

function toDailyCheckinObject(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function dailyCheckinKey(dayKey: string) {
  return `pregunta_${dayKey}`;
}

function slugifyEventTitle(rawTitle: string) {
  return rawTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function scheduleFeedbackKey(eventTitle: string, dayNumber: number) {
  const safeTitle = slugifyEventTitle(eventTitle) || "event";
  return `${safeTitle}_${dayNumber}`;
}

function getBearerToken(req: Request) {
  const authorization = req.headers.authorization || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return "";
  return authorization.slice(7).trim();
}

async function requireSupabaseAuth(req: Request, res: Response, next: NextFunction) {
  // Public endpoint used by clients before registering push subscriptions.
  if (req.path === "/push/public-key") {
    next();
    return;
  }

  // Internal scheduled jobs use x-job-key instead of user bearer auth.
  if (
    req.path === "/jobs/run-all" ||
    req.path === "/jobs/notifications/30min" ||
    req.path === "/jobs/notifications/push-dispatch" ||
    req.path === "/jobs/transcriptions/one-on-ones" ||
    req.path === "/jobs/transcriptions/team-notes" ||
    req.path === "/jobs/matching/run"
  ) {
    next();
    return;
  }

  // Allow internal campaign endpoints with admin key, without Supabase bearer token.
  if (
    req.path.startsWith("/campaigns") ||
    req.path === "/jobs/campaigns/dispatch-due"
  ) {
    const adminKeyHeader = (req.headers["x-admin-key"] || "").toString().trim();
    if (ADMIN_API_KEY && adminKeyHeader && adminKeyHeader === ADMIN_API_KEY) {
      next();
      return;
    }
  }

  if (!JWKS) {
    res.status(500).json({ error: "SUPABASE_URL is not configured in backend env" });
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(401).json({ error: "Token does not include email" });
      return;
    }

    (req as AuthenticatedRequest).auth = {
      sub: String(payload.sub || ""),
      email,
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid auth token" });
  }
}

function requireCampaignAdmin(req: Request, res: Response, next: NextFunction) {
  const auth = req as AuthenticatedRequest;
  const apiKey = (req.headers["x-admin-key"] || "").toString().trim();
  const email = auth.auth?.email?.trim().toLowerCase() || "";
  const apiKeyAllowed = Boolean(ADMIN_API_KEY) && apiKey && apiKey === ADMIN_API_KEY;
  const emailAllowed = email && ADMIN_EMAIL_ALLOWLIST.includes(email);
  if (apiKeyAllowed || emailAllowed) {
    next();
    return;
  }
  res.status(403).json({
    error:
      "Forbidden. Provide CAMPAIGN_ADMIN_API_KEY via x-admin-key or include your user in CAMPAIGN_ADMIN_EMAILS.",
  });
}

function requireJobsApiKey(req: Request, res: Response, next: NextFunction) {
  // Allow local/dev usage when no key is configured.
  if (!JOBS_API_KEY) {
    next();
    return;
  }
  const key = (req.headers["x-job-key"] || "").toString().trim();
  if (!key || key !== JOBS_API_KEY) {
    res.status(403).json({ error: "Forbidden. Missing or invalid x-job-key." });
    return;
  }
  next();
}

type CampaignFilters = z.infer<typeof campaignFiltersSchema>;

async function resolveAudience(filters: CampaignFilters, timeZone = AUDIENCE_TIMEZONE) {
  const todayKey = todayDateKey(timeZone);
  const contactTypes = (filters.contact_types || []).map((v) => v.trim()).filter(Boolean);
  const startupIds = (filters.startup_ids || []).map((v) => v.trim()).filter(Boolean);

  const candidates = await prisma.person.findMany({
    where: {
      ...(contactTypes.length > 0 ? { contact_type: { in: contactTypes } } : {}),
      ...(startupIds.length > 0 ? { startup_id: { in: startupIds } } : {}),
    },
    select: {
      id: true,
      full_name: true,
      contact_type: true,
      startup_id: true,
      arrival_date: true,
      departure_date: true,
      pushSubscriptions: { select: { id: true } },
    },
    orderBy: { full_name: "asc" },
  });

  const filtered = candidates.filter((person) => {
    if (!filters.on_island_today) return true;
    const arrivalKey = dateKeyInTimezone(person.arrival_date, timeZone);
    const departureKey = dateKeyInTimezone(person.departure_date, timeZone);
    const arrivesByToday = !arrivalKey || arrivalKey <= todayKey;
    const leavesAfterToday = !departureKey || departureKey >= todayKey;
    return arrivesByToday && leavesAfterToday;
  });

  const deduped = new Map<string, (typeof filtered)[number]>();
  for (const person of filtered) deduped.set(person.id, person);
  return Array.from(deduped.values());
}

async function dispatchCampaign(campaignId: string, reason = "manual") {
  const now = new Date();
  const campaign = await prisma.notificationCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) {
    throw new Error("Campaign not found");
  }

  if (campaign.status === "sent") {
    throw new Error("Campaign has already been sent");
  }

  const isStuckProcessing = campaign.status === "processing" && !campaign.sent_at;
  const claimableStatuses: NotificationCampaignStatus[] = isStuckProcessing
    ? ["processing"]
    : ["draft", "scheduled", "failed"];

  const claimed = await prisma.notificationCampaign.updateMany({
    where: { id: campaign.id, status: { in: claimableStatuses } },
    data: {
      status: "processing",
      error_message: isStuckProcessing ? "Retrying after previous processing state." : null,
    },
  });

  if (claimed.count === 0) {
    throw new Error("Campaign is already being dispatched");
  }

  try {
    const filters = campaignFiltersSchema.parse(campaign.filters_json);
    const audience = await resolveAudience(filters);
    const targetCount = audience.length;

    if (targetCount === 0) {
      const updated = await prisma.notificationCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "sent",
          target_count: 0,
          created_notifications_count: 0,
          pushed_count: 0,
          sent_at: now,
        },
      });
      return { campaign: updated, targetCount: 0, createdNotificationsCount: 0, pushResult: null };
    }

    await prisma.notificationCampaignRecipient.createMany({
      data: audience.map((person) => ({
        id: crypto.randomUUID(),
        campaign_id: campaign.id,
        user_id: person.id,
      })),
      skipDuplicates: true,
    });

    const recipients = await prisma.notificationCampaignRecipient.findMany({
      where: { campaign_id: campaign.id },
      select: { id: true, user_id: true, notification_id: true },
    });

    let createdNotificationsCount = 0;
    for (const recipient of recipients) {
      if (recipient.notification_id) continue;
      const createdNotification = await prisma.notification.create({
        data: {
          id: crypto.randomUUID(),
          user_id: recipient.user_id,
          event_id: campaign.event_id,
          message: campaign.message,
          sent_at: now,
        },
      });
      createdNotificationsCount += 1;
      await prisma.notificationCampaignRecipient.update({
        where: { id: recipient.id },
        data: {
          notification_id: createdNotification.id,
          delivery_status: "notification_created",
        },
      });
    }

    const pushResult = await runPushDispatch(`campaign-${reason}-${campaign.id}`).catch(() => ({
      processed: 0,
      pushed: 0,
    }));

    await prisma.notificationCampaignRecipient.updateMany({
      where: {
        campaign_id: campaign.id,
        notification_id: { not: null },
      },
      data: { delivery_status: "pushed" },
    });

    const updated = await prisma.notificationCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "sent",
        target_count: targetCount,
        created_notifications_count: createdNotificationsCount,
        pushed_count: Number(pushResult?.pushed || 0),
        sent_at: new Date(),
      },
    });

    return {
      campaign: updated,
      targetCount,
      createdNotificationsCount,
      pushResult,
    };
  } catch (error) {
    await prisma.notificationCampaign.update({
      where: { id: campaign.id },
      data: {
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown campaign dispatch error",
      },
    });
    throw error;
  }
}

app.get("/health", async (_req, res) => {
  // quick DB ping
  await prisma.$queryRaw`SELECT 1`;
  res.json({ ok: true });
});

app.get("/auth/can-register", async (req, res) => {
  const email = z.string().email().parse(req.query.email);
  const person = await findPersonByEmail(email);
  res.json({ allowed: Boolean(person) });
});

/**
 * Create Supabase Auth user when public signups are disabled.
 * Requires SUPABASE_SERVICE_ROLE_KEY (server only). Person must exist by email.
 */
app.post("/auth/register-first-access", async (req, res) => {
  try {
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(6),
        dni: z.string().optional(),
      })
      .safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email or password (min 6 characters)." });
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    const { password, dni } = parsed.data;

    const person = await findPersonByEmail(email);

    if (!person) {
      res.status(403).json({ error: "Email is not registered in the program." });
      return;
    }

    if (person.user_id) {
      res.status(409).json({ error: "Account already exists. Sign in instead." });
      return;
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      res.status(500).json({
        error: "Server missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL",
      });
      return;
    }

    const { data: createdData, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: person.full_name || "",
      },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (
        msg.includes("already registered") ||
        msg.includes("already been registered") ||
        msg.includes("user already registered")
      ) {
        res.status(409).json({ error: "Account already exists. Sign in instead." });
        return;
      }
      res.status(400).json({ error: error.message || "Could not create account" });
      return;
    }

    const createdUserId = createdData?.user?.id || null;
    if (createdUserId) {
      await prisma.person.update({
        where: { id: person.id },
        data: { user_id: createdUserId, ...(dni ? { dni } : {}) },
      });
    }

    res.json({ ok: true });
  } catch (error) {
    const maybe = error as { code?: string; message?: string };
    if (maybe.code === "P2002") {
      res.status(409).json({ error: "Account already linked. Sign in instead." });
      return;
    }
    res.status(500).json({ error: maybe.message || "Could not complete registration." });
  }
});

app.get("/push/public-key", (_req, res) => {
  if (!VAPID_PUBLIC_KEY) {
    res.status(503).json({ error: "Push is not configured (missing VAPID public key)" });
    return;
  }
  res.json({ publicKey: VAPID_PUBLIC_KEY, mode: vapidMode });
});

app.get("/jobs/notifications/push-health", async (_req, res) => {
  const now = new Date();
  const dueCount = await prisma.notification.count({
    where: {
      sent_at: { lte: now },
      pushed_at: null,
    },
  });
  const subscriptionCount = await prisma.pushSubscription.count().catch(() => 0);

  res.json({
    now,
    dueCount,
    subscriptionCount,
    lastDispatchSummary: lastPushDispatchSummary,
  });
});

app.use(requireSupabaseAuth);

app.get("/home-content", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const person = await resolvePersonFromAuth(auth.auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }

    const requestedDateRaw = z.string().optional().parse(req.query.date);
    const dateKey = requestedDateRaw || todayDateKey();
    const parsedDate = parseDateKey(dateKey);
    if (!parsedDate) {
      res.status(400).json({ error: "Invalid date. Expected YYYY-MM-DD" });
      return;
    }

    const record = await prisma.homeDailyContent.findUnique({
      where: { date: parsedDate.date },
    });

    if (!record) {
      res.status(404).json({ error: "No home content found for this date", date: parsedDate.dateKey });
      return;
    }

    res.json(record);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load home content" });
  }
});

app.get("/events", async (req, res) => {
  const auth = req as AuthenticatedRequest;
  if (!auth?.auth?.email || !auth?.auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const person = await resolvePersonFromAuth(auth.auth);
  if (!person) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  try {
    const events = await prisma.event.findMany({
      orderBy: { start_time: "asc" },
    });
    const contactType = normalizeContactType(person.contact_type);
    const visibleEvents = contactType === "team"
      ? events
      : events.filter((event) => isEventVisibleForContactType(event, contactType));
    res.set("Cache-Control", "private, max-age=30");
    res.json(visibleEvents);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load events" });
  }
});

app.post("/campaigns/preview", requireCampaignAdmin, async (req, res) => {
  try {
    const parsed = campaignFiltersSchema.parse(req.body?.filters || {});
    const audience = await resolveAudience(parsed);
    res.json({
      count: audience.length,
      recipients: audience.slice(0, 25).map((person) => ({
        id: person.id,
        full_name: person.full_name,
        contact_type: person.contact_type,
        startup_id: person.startup_id,
        has_push_subscription: person.pushSubscriptions.length > 0,
      })),
      filters: parsed,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid preview payload" });
  }
});

app.post("/campaigns", requireCampaignAdmin, async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    const parsed = campaignCreateSchema.parse(req.body || {});
    const audience = await resolveAudience(parsed.filters);
    const targetCount = audience.length;
    const created = await prisma.notificationCampaign.create({
      data: {
        id: crypto.randomUUID(),
        title: parsed.title,
        message: parsed.message,
        event_id: parsed.event_id || null,
        filters_json: parsed.filters,
        created_by: auth?.sub ? (await resolvePersonFromAuth(auth))?.id || null : null,
        status: parsed.mode === "schedule" ? "scheduled" : parsed.mode === "send_now" ? "processing" : "draft",
        scheduled_for:
          parsed.mode === "schedule" && parsed.scheduled_for ? new Date(parsed.scheduled_for) : null,
        target_count: targetCount,
      },
    });

    if (parsed.mode === "send_now") {
      const result = await dispatchCampaign(created.id, "send-now");
      res.status(201).json(result);
      return;
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid campaign payload" });
  }
});

app.post("/campaigns/:id/send-now", requireCampaignAdmin, async (req, res) => {
  try {
    const id = z.string().parse(req.params.id);
    const result = await dispatchCampaign(id, "send-now-endpoint");
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to dispatch campaign" });
  }
});

app.get("/campaigns", requireCampaignAdmin, async (_req, res) => {
  try {
    const campaigns = await prisma.notificationCampaign.findMany({
      orderBy: { created_at: "desc" },
      take: 100,
      include: {
        event: { select: { id: true, title: true } },
        creator: { select: { id: true, full_name: true, email: true } },
      },
    });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list campaigns" });
  }
});

app.get("/campaigns/:id/stats", requireCampaignAdmin, async (req, res) => {
  try {
    const id = z.string().parse(req.params.id);
    const campaign = await prisma.notificationCampaign.findUnique({
      where: { id },
      include: {
        recipients: {
          select: {
            id: true,
            user_id: true,
            delivery_status: true,
            notification_id: true,
            error_message: true,
          },
        },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json({
      id: campaign.id,
      status: campaign.status,
      target_count: campaign.target_count,
      created_notifications_count: campaign.created_notifications_count,
      pushed_count: campaign.pushed_count,
      recipients_count: campaign.recipients.length,
      recipients: campaign.recipients,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to read campaign stats" });
  }
});

app.get("/auth/debug-link", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized", auth });
    return;
  }

  const byUserId = await prisma.person.findFirst({
    where: { user_id: auth.sub },
    select: { id: true, email: true, user_id: true },
  });
  const byEmail = await findPersonByEmail(auth.email);

  res.json({
    token: {
      sub: auth.sub,
      email: auth.email,
    },
    linked: {
      byUserId,
      byEmail: byEmail ? { id: byEmail.id, email: byEmail.email, user_id: byEmail.user_id } : null,
    },
    verdict: byUserId || byEmail ? "can_link_or_resolve" : "no_person_match",
  });
});

app.get("/me", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const person = await resolvePersonFromAuth(auth);
  if (!person) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  res.set("Cache-Control", "private, max-age=30");
  res.json(person);
});

app.get("/matches/me", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const person = await resolvePersonFromAuth(auth);
  if (!person) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  try {
    const match = await prisma.match.findFirst({
      where: { OR: [{ founder_id: person.id }, { em_id: person.id }] },
      orderBy: { createdAt: "desc" },
      include: {
        founder: { select: personSafeSelect },
        em: { select: personSafeSelect },
      },
    });

    if (!match) {
      res.json({ match: null });
      return;
    }

    const isFounder = match.founder_id === person.id;
    const counterpart = isFounder ? match.em : match.founder;

    res.json({
      match: {
        id: match.id,
        match_date: match.match_date,
        reason_text: match.reason_text,
        createdAt: match.createdAt,
        role: isFounder ? "founder" : "experience_maker",
        counterpart: {
          id: counterpart.id,
          full_name: counterpart.full_name,
          photo_url: counterpart.photo_url,
          tagline: counterpart.tagline,
          contact_type: counterpart.contact_type,
          company_name: counterpart.company_name,
          startup: counterpart.startup ? { name: counterpart.startup.name, tagline: counterpart.startup.tagline } : null,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load match";
    res.status(500).json({ error: message });
  }
});

app.get("/one-on-ones/me", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const me = await resolvePersonFromAuth(auth);
  if (!me) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  try {
    const isEM = normalizeContactType(me.contact_type) === "experience_maker";
    const whereClause = isEM
      ? { em_id: me.id }
      : me.startup_id
        ? { startup_id: me.startup_id }
        : null;

    if (!whereClause) {
      res.json([]);
      return;
    }

    const records = await prisma.oneOnOne.findMany({
      where: whereClause,
      select: {
        id: true,
        startup_id: true,
        em_id: true,
        start_time: true,
        end_time: true,
        location: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        startup: { select: { id: true, name: true, logo_url: true } },
        em: { select: { id: true, full_name: true, photo_url: true } },
      },
      orderBy: { start_time: "asc" },
    });
    res.json(records);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load 1:1 meetings";
    res.status(500).json({ error: message });
  }
});

app.get("/one-on-ones/me/audio", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const me = await resolvePersonFromAuth(auth.auth);
    if (!me) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }

    const isEM = normalizeContactType(me.contact_type) === "experience_maker";
    const audioWhereClause = isEM
      ? { em_id: me.id }
      : me.startup_id
        ? { startup_id: me.startup_id }
        : null;

    if (!audioWhereClause) {
      res.json([]);
      return;
    }

    const oneOnOnes = await prisma.oneOnOne.findMany({
      where: audioWhereClause,
      select: {
        id: true,
        active_audio_url: true,
        active_audio_storage_path: true,
        active_audio_duration_sec: true,
        active_audio_uploaded_at: true,
        active_audio_status: true,
        audio_transcript: true,
        audio_transcript_updated_at: true,
      },
      orderBy: { start_time: "asc" },
    });

    if (oneOnOnes.length === 0) {
      res.json([]);
      return;
    }

    const oneOnOneIds = oneOnOnes.map((oo) => oo.id);
    const allSubmissions = await prisma.oneOnOneAudioSubmission.findMany({
      where: { one_on_one_id: { in: oneOnOneIds } },
      orderBy: { createdAt: "desc" },
    });

    const submissionsByOo = new Map<string, typeof allSubmissions>();
    for (const sub of allSubmissions) {
      const arr = submissionsByOo.get(sub.one_on_one_id) ?? [];
      arr.push(sub);
      submissionsByOo.set(sub.one_on_one_id, arr);
    }

    const result = await Promise.all(
      oneOnOnes.map(async (oo) => {
        const osSubs = (submissionsByOo.get(oo.id) ?? []).slice(0, 50);
        const [activeSignedUrl, ...subSignedUrls] = await Promise.all([
          createOneOnOneAudioSignedUrl(oo.active_audio_storage_path),
          ...osSubs.map((s) => createOneOnOneAudioSignedUrl(s.storage_path)),
        ]);
        return {
          one_on_one_id: oo.id,
          active_audio: {
            url: activeSignedUrl || oo.active_audio_url,
            storage_path: oo.active_audio_storage_path,
            duration_sec: oo.active_audio_duration_sec,
            uploaded_at: oo.active_audio_uploaded_at,
            status: oo.active_audio_status,
          },
          transcript: oo.audio_transcript || "",
          transcript_updated_at: oo.audio_transcript_updated_at,
          submissions: osSubs.map((s, i) => ({ ...s, playback_url: subSignedUrls[i] ?? "" })),
        };
      }),
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load batch one-on-one audio" });
  }
});

const oneOnOneAudioSubmissionSchema = z
  .object({
    storage_path: z.string().min(1).max(1024).optional(),
    public_url: z.string().url().max(2048).optional(),
    mime_type: z.string().max(255).optional(),
    file_size_bytes: z.number().int().positive().max(250 * 1024 * 1024).optional(),
    duration_sec: z.number().int().positive().max(24 * 60 * 60).optional(),
    status: z.enum(["uploaded", "failed"]),
    error_message: z.string().max(2000).optional(),
  })
  .strict();

app.get("/one-on-ones/:id/audio", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const oneOnOneId = z.string().parse(req.params.id);
    const me = await resolvePersonFromAuth(auth.auth);
    if (!me) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }

    const oneOnOne = await resolveAccessibleOneOnOneForPerson(oneOnOneId, me);
    if (!oneOnOne) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const submissions = await prisma.oneOnOneAudioSubmission.findMany({
      where: { one_on_one_id: oneOnOne.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const activeAudioSignedUrl = await createOneOnOneAudioSignedUrl(oneOnOne.active_audio_storage_path);
    const signedSubmissions = await Promise.all(
      submissions.map(async (submission) => ({
        ...submission,
        playback_url: await createOneOnOneAudioSignedUrl(submission.storage_path),
      })),
    );

    res.json({
      one_on_one_id: oneOnOne.id,
      active_audio: {
        url: activeAudioSignedUrl || oneOnOne.active_audio_url,
        storage_path: oneOnOne.active_audio_storage_path,
        duration_sec: oneOnOne.active_audio_duration_sec,
        uploaded_at: oneOnOne.active_audio_uploaded_at,
        status: oneOnOne.active_audio_status,
      },
      transcript: oneOnOne.audio_transcript || "",
      transcript_updated_at: oneOnOne.audio_transcript_updated_at,
      submissions: signedSubmissions,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load one-on-one audio" });
  }
});

app.post("/one-on-ones/:id/audio", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const oneOnOneId = z.string().parse(req.params.id);
    const parsed = oneOnOneAudioSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid audio payload", details: parsed.error.issues });
      return;
    }

    const me = await resolvePersonFromAuth(auth.auth);
    if (!me) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    const contactType = normalizeContactType(me.contact_type);
    if (contactType !== "experience_maker") {
      res.status(403).json({ error: "Only experience makers can submit audio." });
      return;
    }

    const oneOnOne = await resolveAccessibleOneOnOneForPerson(oneOnOneId, me);
    if (!oneOnOne) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const payload = parsed.data;
    if (payload.status === "uploaded" && !payload.storage_path) {
      res.status(400).json({ error: "Uploaded attempts require storage_path" });
      return;
    }
    if (payload.status === "failed" && !payload.error_message) {
      res.status(400).json({ error: "Failed attempts require error_message" });
      return;
    }

    const submissionUserId = me.id?.trim() || "";
    if (!looksLikeUuid(submissionUserId)) {
      res.status(500).json({ error: "Person id is not a valid UUID in database." });
      return;
    }
    const submissionOneOnOneId = oneOnOne.id?.trim() || "";
    if (!looksLikeUuid(submissionOneOnOneId)) {
      res.status(500).json({ error: "One-on-one id is not a valid UUID in database." });
      return;
    }

    const created = await prisma.oneOnOneAudioSubmission.create({
      data: {
        id: crypto.randomUUID(),
        one_on_one_id: submissionOneOnOneId,
        user_id: submissionUserId,
        storage_path: payload.storage_path || null,
        public_url: payload.public_url || null,
        mime_type: payload.mime_type || null,
        file_size_bytes: payload.file_size_bytes || null,
        duration_sec: payload.duration_sec || null,
        status: payload.status,
        error_message: payload.error_message || null,
      },
    });

    if (payload.status === "uploaded") {
      await prisma.oneOnOne.update({
        where: { id: oneOnOne.id },
        data: {
          active_audio_url: payload.public_url || null,
          active_audio_storage_path: payload.storage_path || null,
          active_audio_duration_sec: payload.duration_sec || null,
          active_audio_uploaded_at: new Date(),
          active_audio_status: "uploaded",
        },
      });
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save one-on-one audio" });
  }
});

const teamNoteSchema = z
  .object({
    target_type: z.enum(["startup", "founder"]),
    startup_id: z.string().min(1).optional(),
    founder_id: z.string().min(1).optional(),
    storage_path: z.string().min(1).max(1024).optional(),
    public_url: z.string().url().max(2048).optional(),
    mime_type: z.string().max(255).optional(),
    file_size_bytes: z.number().int().positive().max(250 * 1024 * 1024).optional(),
    duration_sec: z.number().int().positive().max(24 * 60 * 60).optional(),
    status: z.enum(["uploaded", "failed"]),
    error_message: z.string().max(2000).optional(),
    notes: z.string().max(5000).optional(),
  })
  .strict();

app.get("/team-notes/me", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const me = await resolvePersonFromAuth(auth.auth);
    if (!me) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    if (normalizeContactType(me.contact_type) !== "team") {
      res.status(403).json({ error: "Only team members can access team notes." });
      return;
    }

    const teamNotes = await prisma.teamAudioNote.findMany({
      where: { team_member_id: me.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        startup: { select: { id: true, name: true, logo_url: true } },
        founder: { select: { id: true, full_name: true, photo_url: true } },
      },
    });

    const admin = getSupabaseAdmin();
    const result = await Promise.all(
      teamNotes.map(async (note) => {
        let signedUrl = "";
        if (admin && note.storage_path) {
          const { data } = await admin.storage
            .from(ONE_ON_ONE_AUDIO_BUCKET)
            .createSignedUrl(note.storage_path, ONE_ON_ONE_AUDIO_SIGNED_URL_TTL_SEC);
          signedUrl = data?.signedUrl || "";
        }
        return { ...note, playback_url: signedUrl || note.public_url || "" };
      }),
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load team notes" });
  }
});

app.post("/team-notes", async (req, res) => {
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const me = await resolvePersonFromAuth(auth.auth);
    if (!me) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    if (normalizeContactType(me.contact_type) !== "team") {
      res.status(403).json({ error: "Only team members can submit team notes." });
      return;
    }

    const parsed = teamNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid team note payload" });
      return;
    }
    const payload = parsed.data;

    if (payload.target_type === "startup" && !payload.startup_id) {
      res.status(400).json({ error: "startup_id is required when target_type is startup" });
      return;
    }
    if (payload.target_type === "founder" && !payload.founder_id) {
      res.status(400).json({ error: "founder_id is required when target_type is founder" });
      return;
    }
    if (payload.status === "uploaded" && !payload.storage_path) {
      res.status(400).json({ error: "storage_path is required for uploaded notes" });
      return;
    }

    const created = await prisma.teamAudioNote.create({
      data: {
        team_member_id: me.id,
        target_type: payload.target_type,
        startup_id: payload.startup_id || null,
        founder_id: payload.founder_id || null,
        storage_path: payload.storage_path || null,
        public_url: payload.public_url || null,
        mime_type: payload.mime_type || null,
        file_size_bytes: payload.file_size_bytes || null,
        duration_sec: payload.duration_sec || null,
        status: payload.status,
        error_message: payload.error_message || null,
        notes: payload.notes || null,
      },
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save team note" });
  }
});

app.post("/push/subscribe", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z
    .object({
      endpoint: z.string().url(),
      keys: z.object({
        p256dh: z.string().min(1),
        auth: z.string().min(1),
      }),
    })
    .safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid push subscription payload" });
    return;
  }
  try {
    const person = await resolvePersonFromAuth(auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    const userAgent = req.headers["user-agent"]?.toString() || null;
    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_id: person.id,
        user_agent: userAgent,
      },
      update: {
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_id: person.id,
        user_agent: userAgent,
      },
    });
    if (userAgent) {
      await prisma.pushSubscription.deleteMany({
        where: {
          user_id: person.id,
          user_agent: userAgent,
          endpoint: { not: parsed.data.endpoint },
        },
      });
    }
    await runPushDispatch("subscribe").catch(() => {
      // Ignore dispatch failures here; subscription itself succeeded.
    });
    res.json({ ok: true });
  } catch (error) {
    if (isMissingTableError(error, "PushSubscription")) {
      res.status(500).json({ error: "PushSubscription table is missing. Run migrations." });
      return;
    }
    throw error;
  }
});

app.post("/push/unsubscribe", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid unsubscribe payload" });
    return;
  }
  try {
    await prisma.pushSubscription.deleteMany({
      where: { endpoint: parsed.data.endpoint },
    });
    res.json({ ok: true });
  } catch (error) {
    if (isMissingTableError(error, "PushSubscription")) {
      res.json({ ok: true, skipped: true });
      return;
    }
    throw error;
  }
});

// Directories
app.get("/people", async (req, res) => {
  const q = z.string().optional().parse(req.query.q);
  const people = await prisma.person.findMany({
    where: q
      ? {
          OR: [
            { full_name: { contains: q } },
            { company_name: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { full_name: "asc" },
    select: personSafeSelect,
  });
  res.set("Cache-Control", "private, max-age=30");
  res.json(people);
});

app.get("/people/:id", async (req, res) => {
  const id = z.string().parse(req.params.id);
  const person = await prisma.person.findUnique({
    where: { id },
    select: personSafeSelect,
  });
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  res.json(person);
});

app.get("/startups", async (req, res) => {
  const q = z.string().optional().parse(req.query.q);
  const startups = await prisma.startup.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q } },
            { sector: { contains: q } },
            { tagline: { contains: q } },
          ],
        }
      : undefined,
    orderBy: { name: "asc" },
  });
  res.set("Cache-Control", "private, max-age=30");
  res.json(startups);
});

app.get("/startups/:id", async (req, res) => {
  const id = z.string().parse(req.params.id);
  const startup = await prisma.startup.findUnique({
    where: { id },
  });
  if (!startup) {
    res.status(404).json({ error: "Startup not found" });
    return;
  }
  res.json(startup);
});
app.get("/events/:eventId/people", async (req, res) => {
  try {
    const eventId = z.string().parse(req.params.eventId);
    const people = await prisma.person.findMany({
      where: {
        userEvents: {
          some: { event_id: eventId },
        },
      },
      select: personSafeSelect,
      orderBy: { full_name: "asc" },
    });
    res.json(people);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load event people";
    res.status(500).json({ error: message });
  }
});

app.get("/feedback/schedule/:dayKey", async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth?.email || !auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsedDay = parseScheduleDayKey(z.string().parse(req.params.dayKey));
    if (!parsedDay) {
      res.status(400).json({ error: "Invalid day key. Expected YYYY-MM-DD" });
      return;
    }
    const person = await resolvePersonFromAuth(auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    const feedback = toScheduleFeedbackObject(person.schedule_feedback);
    const suffix = `_${parsedDay.dayNumber}`;
    const dayRatings = Object.fromEntries(
      Object.entries(feedback).filter(([key]) => key.endsWith(suffix)),
    );
    res.json({
      day: parsedDay.dayKey,
      day_number: parsedDay.dayNumber,
      ratings: dayRatings,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load schedule feedback" });
  }
});

app.put("/feedback/schedule/:dayKey", async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth?.email || !auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    personResolutionCache.delete(auth.sub);
    const parsedDay = parseScheduleDayKey(z.string().parse(req.params.dayKey));
    if (!parsedDay) {
      res.status(400).json({ error: "Invalid day key. Expected YYYY-MM-DD" });
      return;
    }
    const parsedBody = z
      .object({
        event_id: z.string().min(1).optional(),
        event_title: z.string().min(1).optional(),
        rating: z.number().int().min(1).max(5),
      })
      .safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "Invalid feedback payload" });
      return;
    }
    const person = await resolvePersonFromAuth(auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }

    let eventTitle = parsedBody.data.event_title?.trim() || "";
    if (!eventTitle && parsedBody.data.event_id) {
      const event = await prisma.event.findUnique({
        where: { id: parsedBody.data.event_id },
        select: { title: true },
      });
      if (!event?.title) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      eventTitle = event.title;
    }
    if (!eventTitle) {
      res.status(400).json({ error: "event_id or event_title is required" });
      return;
    }

    const key = scheduleFeedbackKey(eventTitle, parsedDay.dayNumber);
    const feedback = toScheduleFeedbackObject(person.schedule_feedback);
    feedback[key] = parsedBody.data.rating;

    const updated = await prisma.person.update({
      where: { id: person.id },
      data: { schedule_feedback: feedback },
      select: { schedule_feedback: true },
    });

    res.json({
      ok: true,
      key,
      rating: parsedBody.data.rating,
      schedule_feedback: toScheduleFeedbackObject(updated.schedule_feedback),
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save schedule feedback" });
  }
});

app.get("/check-in/daily/:dayKey", async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth?.email || !auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const parsedDay = parseScheduleDayKey(z.string().parse(req.params.dayKey));
    if (!parsedDay) {
      res.status(400).json({ error: "Invalid day key. Expected YYYY-MM-DD" });
      return;
    }
    const person = await resolvePersonFromAuth(auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    const key = dailyCheckinKey(parsedDay.dayKey);
    const checkin = toDailyCheckinObject(person.daily_checkin);
    res.json({
      day: parsedDay.dayKey,
      key,
      already_submitted: key in checkin,
      result: (checkin[key] as Record<string, unknown> | undefined) || null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load daily check-in" });
  }
});

app.put("/check-in/daily/:dayKey", async (req, res) => {
  try {
    const auth = (req as AuthenticatedRequest).auth;
    if (!auth?.email || !auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    personResolutionCache.delete(auth.sub);
    const parsedDay = parseScheduleDayKey(z.string().parse(req.params.dayKey));
    if (!parsedDay) {
      res.status(400).json({ error: "Invalid day key. Expected YYYY-MM-DD" });
      return;
    }
    const parsedBody = z
      .object({
        energy:     z.number().int().min(1).max(5),
        clarity:    z.number().int().min(1).max(5),
        connection: z.number().int().min(1).max(5),
      })
      .safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "Invalid daily check-in payload" });
      return;
    }
    const person = await resolvePersonFromAuth(auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }

    const key = dailyCheckinKey(parsedDay.dayKey);
    const checkin = toDailyCheckinObject(person.daily_checkin);
    if (key in checkin) {
      res.status(409).json({ error: "Daily check-in already submitted for this day", key });
      return;
    }

    checkin[key] = {
      ...parsedBody.data,
      submitted_at: new Date().toISOString(),
    };

    const updated = await prisma.person.update({
      where: { id: person.id },
      data: { daily_checkin: checkin as Prisma.InputJsonValue },
      select: { daily_checkin: true },
    });

    const stored = toDailyCheckinObject(updated.daily_checkin);
    res.json({
      ok: true,
      day: parsedDay.dayKey,
      key,
      result: (stored[key] as Record<string, unknown> | undefined) || null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save daily check-in" });
  }
});

// Personalized agenda (fallbacks to master program)
app.get("/users/:userId/schedule", async (req, res) => {
  const requestedUserId = z.string().parse(req.params.userId);
  try {
    const auth = req as AuthenticatedRequest;
    if (!auth?.auth?.email || !auth?.auth?.sub) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const person = await resolvePersonFromAuth(auth.auth);
    if (!person) {
      res.status(403).json({ error: "No person record linked to this email" });
      return;
    }
    const allowedUserIds = new Set([person.id, person.user_id || ""]);
    if (!allowedUserIds.has(requestedUserId)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const joins = await prisma.userEvent.findMany({
      where: { user_id: person.id },
      include: { event: true },
      orderBy: { event: { start_time: "asc" } },
    });
    const contactType = normalizeContactType(person.contact_type);
    const visibleEvents = joins
      .map((j) => j.event)
      .filter((event) => isEventVisibleForContactType(event, contactType));
    res.json(visibleEvents);
  } catch (error) {
    res.status(500).json({ error: "Failed to load user schedule" });
  }
});

// Notifications (in-app alerts)
app.get("/users/:userId/notifications", async (req, res) => {
  const userId = z.string().parse(req.params.userId);
  const unread = z
    .enum(["true", "false"])
    .optional()
    .parse(req.query.unread);

  try {
    const notifs = await prisma.notification.findMany({
      where: {
        user_id: userId,
        sent_at: { lte: new Date() },
        ...(unread === "true" ? { is_read: false } : {}),
      },
      include: {
        campaignRecipients: {
          include: { campaign: { select: { title: true } } },
          take: 1,
        },
        match: { select: { founder_id: true, em_id: true } },
      },
      orderBy: { sent_at: "desc" },
      take: 50,
    });
    res.json(
      notifs.map((n) => ({
        ...n,
        title: n.campaignRecipients?.[0]?.campaign?.title ?? null,
        counterpart_person_id: n.match ? (n.match.founder_id === userId ? n.match.em_id : n.match.founder_id) : null,
        campaignRecipients: undefined,
        match: undefined,
      })),
    );
  } catch (error) {
    if (isMissingTableError(error, "Notification")) {
      res.json([]);
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to load notifications";
    res.status(500).json({ error: message });
  }
});

app.patch("/notifications/:notificationId/read", async (req, res) => {
  const notificationId = z.string().parse(req.params.notificationId);
  try {
    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { is_read: true },
    });
    res.json(updated);
  } catch (error) {
    if (isMissingTableError(error, "Notification")) {
      res.json({ id: notificationId, is_read: true, skipped: true });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to mark notification read";
    res.status(500).json({ error: message });
  }
});

app.patch("/users/:userId/notifications/read-all", async (req, res) => {
  const userId = z.string().parse(req.params.userId);
  try {
    const result = await prisma.notification.updateMany({
      where: {
        user_id: userId,
        is_read: false,
      },
      data: { is_read: true },
    });
    res.json(result);
  } catch (error) {
    if (isMissingTableError(error, "Notification")) {
      res.json({ count: 0, skipped: true });
      return;
    }
    const message = error instanceof Error ? error.message : "Failed to mark all notifications read";
    res.status(500).json({ error: message });
  }
});

app.post("/jobs/notifications/30min", requireJobsApiKey, async (_req, res) => {
  const result = await triggerThirtyMinuteReminders(new Date());
  res.json(result);
});

app.post("/jobs/notifications/push-dispatch", requireJobsApiKey, async (_req, res) => {
  const result = await runPushDispatch("manual");
  res.json(result);
});

app.post("/jobs/run-all", requireJobsApiKey, async (_req, res) => {
  const now = new Date();
  const reminders = await triggerThirtyMinuteReminders(now);
  const campaigns = await runScheduledCampaignDispatch(now);
  const push = await runPushDispatch("cron");
  const transcriptions = await runOneOnOneTranscriptionJob(20);
  const teamTranscriptions = await runTeamNoteTranscriptionJob(20);
  const matching = await runDailyMatchingJob(50);
  res.json({
    ok: true,
    ran_at: now,
    reminders,
    campaigns,
    push,
    transcriptions,
    teamTranscriptions,
    matching,
  });
});

app.post("/jobs/transcriptions/one-on-ones", requireJobsApiKey, async (req, res) => {
  try {
    const parsedLimit = z.coerce.number().int().min(1).max(100).optional().safeParse(req.query.limit);
    const limit = parsedLimit.success && parsedLimit.data ? parsedLimit.data : 10;
    const result = await runOneOnOneTranscriptionJob(limit);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run one-on-one transcription job";
    res.status(500).json({ error: message });
  }
});

app.post("/jobs/transcriptions/team-notes", requireJobsApiKey, async (req, res) => {
  try {
    const parsedLimit = z.coerce.number().int().min(1).max(100).optional().safeParse(req.query.limit);
    const limit = parsedLimit.success && parsedLimit.data ? parsedLimit.data : 10;
    const result = await runTeamNoteTranscriptionJob(limit);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run team note transcription job";
    res.status(500).json({ error: message });
  }
});

app.post("/jobs/matching/run", requireJobsApiKey, async (req, res) => {
  try {
    const parsedLimit = z.coerce.number().int().min(1).max(200).optional().safeParse(req.query.limit);
    const limit = parsedLimit.success && parsedLimit.data ? parsedLimit.data : 50;
    const result = await runDailyMatchingJob(limit);
    res.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to run matching job";
    res.status(500).json({ error: message });
  }
});

app.post("/jobs/campaigns/dispatch-due", requireCampaignAdmin, async (_req, res) => {
  const result = await runScheduledCampaignDispatch(new Date());
  res.json(result);
});

app.get("/jobs/notifications/push-debug", async (_req, res) => {
  const now = new Date();
  const dueNotifications = await prisma.notification.findMany({
    where: {
      sent_at: { lte: now },
      pushed_at: null,
    },
    include: {
      user: {
        include: {
          pushSubscriptions: true,
        },
      },
    },
    orderBy: { sent_at: "asc" },
    take: 20,
  });

  res.json({
    now,
    lastDispatchSummary: lastPushDispatchSummary,
    dueCount: dueNotifications.length,
    dueNotifications: dueNotifications.map((notification) => ({
      id: notification.id,
      user_id: notification.user_id,
      message: notification.message,
      sent_at: notification.sent_at,
      pushed_at: notification.pushed_at,
      subscriptionCount: notification.user.pushSubscriptions.length,
    })),
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;

runPushDispatch("startup")
  .then((result) => {
    if (result.processed > 0) {
      return;
    }
  })
  .catch(() => {
    // Ignore to keep server alive.
  });

runScheduledCampaignDispatch(new Date()).catch(() => {
  // Ignore to keep server alive.
});

// Poll due notifications and deliver push payloads.
setInterval(() => {
  runPushDispatch("interval")
    .then(() => {
      return;
    })
    .catch(() => {
      // Ignore to keep server alive.
    });
}, 30000);

setInterval(() => {
  runScheduledCampaignDispatch(new Date()).catch(() => {
    // Ignore to keep server alive.
  });
}, 30000);

// 30-minute reminders disabled — notifications are managed manually in the DB.
// setInterval(() => {
//   triggerThirtyMinuteReminders(new Date()).catch(() => {});
// }, 60000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});

