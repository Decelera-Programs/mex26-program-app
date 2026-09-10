import "dotenv/config";
import { createHash } from "node:crypto";
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

// The program runs in Mexico. All "what day is it" / presence checks
// (campaign audiences, on-site-today filters) resolve against this timezone.
const AUDIENCE_TIMEZONE = "America/Mexico_City";
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
const OPENAI_EMBEDDING_MODEL = (process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small").trim();

// Founder<->Experience Maker daily matching runs in the program's timezone.
const MATCHING_TIMEZONE = "America/Mexico_City";
const MATCH_CANDIDATE_POOL_SIZE = 10;
const MATCH_WEIGHT_CHALLENGE = 3;
const MATCH_WEIGHT_DIRECT_TAG = 1;
// Semantic term: cosine similarity between the founder's stated need
// (challenge_name + expertise_wanted + top sections) and the EM's profile
// (tagline + expertise_tags + bio), rescaled from [SIM_MIN, SIM_MAX] to [0, 1]
// and worth up to MATCH_WEIGHT_TEXT "tag points". The tag-overlap score stays as
// a floor; this only adds. If OPENAI_API_KEY is unset the term is simply 0.
const MATCH_WEIGHT_TEXT = 8;
const MATCH_TEXT_SIM_MIN = 0.15;
const MATCH_TEXT_SIM_MAX = 0.55;
// Quality floor. Minimum fit score (tag overlap + semantic similarity, BEFORE the
// feedback / cooldown multipliers) for an assigned pair to actually become a match.
// Below this the greedy assignment only parked two people together to fill a slot —
// no meaningful tag overlap and negligible semantic similarity — so the founder gets
// no recommendation that day rather than a generic one (skip reason
// "below_quality_floor", visible in ?dryRun=1). One challenge-derived tag hit is worth
// MATCH_WEIGHT_CHALLENGE (3) and a modest semantic signal clears this on its own;
// raise it to be stricter.
const MATCH_MIN_SCORE = 2.0;
// Hard ceiling on how many founders one EM can be matched with in a single day.
const MATCH_EM_DAILY_CAPACITY_CAP = 4;
// A challenge section counts as "a real problem" at this average severity.
// Ratings are 1-4 ("1 — Not a priority" ... "4 — Critical / blocking"), so requiring an
// average >= 3 meant every sub-topic had to be an active pain point — too strict; most
// founders then scored against a single section. 2.5 is a saner bar.
const MATCH_CHALLENGE_SEVERITY_THRESHOLD = 2.5;

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
  // Broadened beyond pure marketing/comms tags on purpose: for an early-stage startup,
  // marketing / positioning / channels overlap heavily with growth & GTM, and EMs carrying
  // literal marketing tags are always scarce. Adjacent growth/GTM/consumer expertise counts.
  marketing_communication: [
    "Digital marketing", "Inbound marketing", "Communication", "Brand",
    "GTM", "Sales / Growth", "B2C",
  ],
};

// The (founder, EM) pair is decided by the global assignment; OpenAI only writes
// the conversation prompt: `topic` (a concrete thing to talk about) + `opener`
// (a line the founder can literally say). Parsed leniently in writeMatchTopic —
// over-long strings are clipped, a missing opener is tolerated, only a missing
// topic falls back to the deterministic text.

// After a match: "did you talk?" and, if so, "what did you take away?".
// `useful` is derived from `takeaway` (anything but "nothing" -> true) when not sent.
const matchFeedbackSchema = z
  .object({
    talked: z.boolean(),
    useful: z.boolean().nullable().optional(),
    takeaway: z.enum(["idea", "contact", "perspective", "nothing"]).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

// EM-level reputation: EMs that founders repeatedly find unhelpful get their
// match scores dampened. Needs a minimum sample size so one bad rating can't
// sink an EM, and a lookback so old feedback fades.
const MATCH_FEEDBACK_LOOKBACK_DAYS = 14;
const MATCH_FEEDBACK_MIN_SAMPLES = 2;
const MATCH_FEEDBACK_MIN_MULTIPLIER = 0.4;

// Repeated (founder, EM) pairs: instead of a hard ban, dampen the score and let
// it recover over a cooldown. A pair matched within HARD_EXCLUDE_DAYS is skipped
// outright; a pair the founder last rated useful:false cools down much slower;
// a pair last rated useful:true carries no penalty.
const MATCH_PAIR_HARD_EXCLUDE_DAYS = 1;
const MATCH_PAIR_COOLDOWN_DAYS = 3;
const MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS = 10;

// End-of-day nudge to rate the day's match. runMatchFeedbackReminders only fires
// once the local hour in MATCHING_TIMEZONE reaches this, and sends at most one
// reminder per person per match (tracked in match.feedback.reminders).
const MATCH_FEEDBACK_REMINDER_HOUR = 20;
// How long a match with no feedback keeps surfacing on /matches/me as a "pending"
// card, so an evening conversation still gets rated the next morning.
const MATCH_FEEDBACK_PENDING_DAYS = 2;
// Push/notification copy for a fresh daily match. Deliberately a teaser — the
// details (counterpart, topic, questions) live on the card the user opens.
const MATCH_NOTIFICATION_TEXT = "Tenemos una sugerencia que te podría interesar!!";

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

// Local hour (0-23) in the given timezone. Used to gate end-of-day jobs.
function hourInTimezone(raw: Date | string | null | undefined = new Date(), timeZone = AUDIENCE_TIMEZONE) {
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
    const payload = JSON.stringify({
      title: campaignTitle || "Decelera México",
      body: notification.message,
      eventId: notification.event_id ?? null,
      // Any match-linked notification (daily match, "quiero hablar" ping,
      // feedback reminder) opens Home and surfaces the match card.
      matchId: notification.match_id ?? null,
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
  const match = ratingText.match(/^\s*(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null;
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
  const root = challenges && typeof challenges === "object" ? (challenges as { sections?: unknown }) : {};
  const sections =
    root.sections && typeof root.sections === "object" ? (root.sections as Record<string, unknown>) : {};
  const scored = Object.entries(sections)
    .map(([section, data]) => {
      const ratings = data && typeof data === "object" ? (data as { ratings?: unknown }).ratings : null;
      const ratingsObj = ratings && typeof ratings === "object" ? (ratings as Record<string, unknown>) : {};
      const values = Object.values(ratingsObj)
        .map(parseRatingSeverity)
        .filter((v): v is number => v != null);
      if (values.length === 0) return null;
      const avgSeverity = values.reduce((a, b) => a + b, 0) / values.length;
      return { section, avgSeverity };
    })
    .filter((v): v is { section: string; avgSeverity: number } => v != null)
    .sort((a, b) => b.avgSeverity - a.avgSeverity);

  const priority = scored
    .filter((s) => s.avgSeverity >= MATCH_CHALLENGE_SEVERITY_THRESHOLD)
    .slice(0, 2);
  return priority.length > 0 ? priority : scored.slice(0, 2);
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
  bio: string | null;
  tagline: string | null;
  photo_url: string | null;
  contact_type: string | null;
  company_name: string | null;
  expertise_tags: unknown;
  embedding: unknown;
  startup_id: string | null;
  arrival_date: Date | null;
  departure_date: Date | null;
  startup: { id: string; name: string; challenges: unknown; challenge_embedding: unknown } | null;
};

async function loadMatchingPoolForToday() {
  const todayKey = todayDateKey(MATCHING_TIMEZONE);
  const people = await prisma.person.findMany({
    where: { contact_type: { in: ["founder", "experience_maker"] } },
    select: {
      id: true,
      full_name: true,
      bio: true,
      tagline: true,
      photo_url: true,
      contact_type: true,
      company_name: true,
      expertise_tags: true,
      embedding: true,
      startup_id: true,
      arrival_date: true,
      departure_date: true,
      startup: { select: { id: true, name: true, challenges: true, challenge_embedding: true } },
    },
  });

  // Both bounds are required: a missing arrival/departure means we don't know
  // whether the person is on site, so they are NOT matched. (A null bound used to
  // be treated as "unbounded", which kept people with incomplete dates in the
  // pool forever.)
  const presentIds = new Set(
    people
      .filter((p) => {
        const arrivalKey = dateKeyInTimezone(p.arrival_date, MATCHING_TIMEZONE);
        const departureKey = dateKeyInTimezone(p.departure_date, MATCHING_TIMEZONE);
        return Boolean(
          arrivalKey && departureKey && arrivalKey <= todayKey && departureKey >= todayKey,
        );
      })
      .map((p) => p.id),
  );

  const alreadyMatchedToday = new Set(
    (
      await prisma.match.findMany({
        where: { match_date: new Date(`${todayKey}T00:00:00.000Z`) },
        select: { founder_id: true },
      })
    ).map((m) => m.founder_id),
  );

  const excludedFounders: Array<{ id: string; full_name: string; reason: string }> = [];
  const founders: typeof people = [];
  for (const p of people) {
    if (p.contact_type !== "founder") continue;
    if (alreadyMatchedToday.has(p.id)) {
      excludedFounders.push({ id: p.id, full_name: p.full_name, reason: "already_matched_today" });
    } else if (!presentIds.has(p.id)) {
      const reason =
        p.arrival_date && p.departure_date ? "not_present_today" : "no_presence_dates";
      excludedFounders.push({ id: p.id, full_name: p.full_name, reason });
    } else if (
      !hasMeaningfulExpertiseTags(p.expertise_tags) &&
      !hasMeaningfulChallenges(p.startup?.challenges)
    ) {
      excludedFounders.push({ id: p.id, full_name: p.full_name, reason: "no_challenges_or_tags" });
    } else {
      founders.push(p);
    }
  }

  const ems = people.filter(
    (p) =>
      p.contact_type === "experience_maker" &&
      presentIds.has(p.id) &&
      hasMeaningfulExpertiseTags(p.expertise_tags),
  );

  return { founders, ems, todayKey, excludedFounders };
}

// ---- Semantic scoring (C2): cached embeddings + cosine similarity ----------

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Rescale a raw cosine into "tag points": <= SIM_MIN -> 0, >= SIM_MAX -> full weight.
function textSimToPoints(cosine: number): number {
  const span = MATCH_TEXT_SIM_MAX - MATCH_TEXT_SIM_MIN;
  const norm = span > 0 ? (cosine - MATCH_TEXT_SIM_MIN) / span : 0;
  return MATCH_WEIGHT_TEXT * Math.max(0, Math.min(1, norm));
}

function deepDiveText(challenges: unknown): { challengeName: string; expertiseWanted: string } {
  const dd = (
    challenges as { deep_dive?: { challenge_name?: unknown; expertise_wanted?: unknown } } | null
  )?.deep_dive;
  return {
    challengeName: typeof dd?.challenge_name === "string" ? dd.challenge_name : "",
    expertiseWanted: typeof dd?.expertise_wanted === "string" ? dd.expertise_wanted : "",
  };
}

// The founder "need" text is startup-scoped (challenge + wanted expertise), so it's
// cached on Startup.challenge_embedding and shared by co-founders.
function founderNeedText(startup: MatchCandidatePerson["startup"]): string {
  if (!startup) return "";
  const { challengeName, expertiseWanted } = deepDiveText(startup.challenges);
  const sections = topChallengeSections(startup.challenges)
    .map((s) => s.section.replace(/_/g, " "))
    .join(", ");
  return [startup.name, challengeName, expertiseWanted, sections].filter(Boolean).join("\n").trim();
}

function emOfferText(em: MatchCandidatePerson): string {
  const tags = hasMeaningfulExpertiseTags(em.expertise_tags) ? em.expertise_tags.join(", ") : "";
  return [em.full_name, em.company_name, em.tagline, tags, em.bio].filter(Boolean).join("\n").trim();
}

async function embedText(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in backend env");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: text.slice(0, 8000) }),
    });
  } finally {
    clearTimeout(timeout);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload?.error?.message || "OpenAI embeddings request failed");
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("Empty embedding response");
  return vector;
}

function cachedVector(cache: unknown, expectedHash: string): number[] | null {
  if (!cache || typeof cache !== "object") return null;
  const c = cache as { hash?: unknown; model?: unknown; vector?: unknown };
  if (c.hash !== expectedHash || c.model !== OPENAI_EMBEDDING_MODEL) return null;
  return Array.isArray(c.vector) && c.vector.length > 0 ? (c.vector as number[]) : null;
}

type EmbeddingSpec = { key: string; text: string; cached: unknown };

// Reuse the cached vector when the source text is unchanged, otherwise call OpenAI
// and write it back (best-effort). Never throws — a key that fails is simply absent
// from the result and its text term is 0 for the day (recovered on the next run).
async function resolveEmbeddings(
  specs: EmbeddingSpec[],
  persist: (key: string, value: Prisma.InputJsonValue) => Promise<unknown>,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!OPENAI_API_KEY) return out;

  const stale: Array<{ key: string; text: string; hash: string }> = [];
  for (const spec of specs) {
    const text = spec.text.trim();
    if (!text) continue;
    const hash = hashText(`${OPENAI_EMBEDDING_MODEL}:${text}`);
    const hit = cachedVector(spec.cached, hash);
    if (hit) out.set(spec.key, hit);
    else stale.push({ key: spec.key, text, hash });
  }
  if (stale.length === 0) return out;

  const results = await Promise.allSettled(stale.map((s) => embedText(s.text)));
  await Promise.all(
    results.map(async (r, i) => {
      if (r.status !== "fulfilled") return;
      const { key, hash } = stale[i];
      out.set(key, r.value);
      try {
        await persist(key, {
          hash,
          model: OPENAI_EMBEDDING_MODEL,
          vector: r.value,
        } as Prisma.InputJsonValue);
      } catch {
        // Best-effort cache write; the vector is still used for today's run.
      }
    }),
  );
  return out;
}

async function loadFounderNeedVectors(
  founders: MatchCandidatePerson[],
): Promise<Map<string, number[]>> {
  const byStartup = new Map<string, EmbeddingSpec>();
  for (const f of founders) {
    if (!f.startup_id || !f.startup || byStartup.has(f.startup_id)) continue;
    byStartup.set(f.startup_id, {
      key: f.startup_id,
      text: founderNeedText(f.startup),
      cached: f.startup.challenge_embedding,
    });
  }
  return resolveEmbeddings([...byStartup.values()], (key, value) =>
    prisma.startup.update({ where: { id: key }, data: { challenge_embedding: value } }),
  );
}

async function loadEmOfferVectors(ems: MatchCandidatePerson[]): Promise<Map<string, number[]>> {
  return resolveEmbeddings(
    ems.map((e) => ({ key: e.id, text: emOfferText(e), cached: e.embedding })),
    (key, value) => prisma.person.update({ where: { id: key }, data: { embedding: value } }),
  );
}

// ---------------------------------------------------------------------------

type CandidateScore = {
  em: MatchCandidatePerson;
  score: number;
  tagScore: number;
  textScore: number;
};

function scoreCandidates(
  founder: MatchCandidatePerson,
  ems: MatchCandidatePerson[],
  hardExcludedPairs: Set<string>,
  ctx?: { founderNeedVec?: number[] | null; emOfferVecs?: Map<string, number[]> },
): CandidateScore[] {
  const founderTags = hasMeaningfulExpertiseTags(founder.expertise_tags) ? founder.expertise_tags : [];
  const challengeTags = tagsFromChallengeSections(founder.startup?.challenges);
  const needVec = ctx?.founderNeedVec ?? null;

  // Return every viable EM (score > 0); the daily job trims/penalises from here.
  return ems
    .filter((em) => !hardExcludedPairs.has(`${founder.id}:${em.id}`))
    .map((em) => {
      const emTags = hasMeaningfulExpertiseTags(em.expertise_tags) ? em.expertise_tags : [];
      const challengeOverlap = emTags.filter((t) => challengeTags.includes(t)).length;
      const directOverlap = emTags.filter((t) => founderTags.includes(t)).length;
      const tagScore =
        challengeOverlap * MATCH_WEIGHT_CHALLENGE + directOverlap * MATCH_WEIGHT_DIRECT_TAG;

      const emVec = ctx?.emOfferVecs?.get(em.id);
      const textScore = needVec && emVec ? textSimToPoints(cosineSimilarity(needVec, emVec)) : 0;

      return { em, score: tagScore + textScore, tagScore, textScore };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.em.id.localeCompare(b.em.id));
}

type MatchBrief = {
  topic: string;
  opener: string;
  why: string[];
  questions: string[];
  em_blurb: string;
};

async function writeMatchTopic(
  founder: MatchCandidatePerson,
  em: MatchCandidatePerson,
): Promise<MatchBrief> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured in backend env");
  }

  const challenges = founder.startup?.challenges as
    | { deep_dive?: { challenge_name?: string; expertise_wanted?: string } }
    | undefined;
  const founderContext = {
    full_name: founder.full_name,
    startup_name: founder.startup?.name || null,
    expertise_tags: founder.expertise_tags,
    priority_challenges: topChallengeSections(founder.startup?.challenges),
    challenge_name: challenges?.deep_dive?.challenge_name || null,
    expertise_wanted: challenges?.deep_dive?.expertise_wanted || null,
  };
  const emContext = {
    full_name: em.full_name,
    tagline: em.tagline,
    company_name: em.company_name,
    expertise_tags: em.expertise_tags,
  };

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
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Eres el asistente de conexiones informales del programa Decelera Mexico 2026. " +
              "Se te da un founder con su reto vivo y un experience maker con el que YA esta emparejado para hoy. " +
              "El founder deberia hablar con el de forma informal (en una pausa o comida, SIN agendar reunion) " +
              "para una conversacion corta y util. Todo en espanol, concreto, nada generico, anclado en el reto " +
              "real del founder y en algo especifico del expertise o la experiencia de ese EM. Genera: " +
              "1) \"topic\": max 140 caracteres. UN tema accionable del que hablar. " +
              "2) \"why\": array de 2 o 3 strings, max 110 caracteres cada uno. Por que tiene sentido esta pareja " +
              "(cita el reto del founder y algo concreto del EM). " +
              "3) \"questions\": array de EXACTAMENTE 3 strings, max 130 caracteres cada una. Preguntas concretas " +
              "que el founder puede hacerle, ancladas en el reto. " +
              "4) \"opener\": max 150 caracteres. Frase en primera persona que el founder pueda decirle literalmente " +
              "para arrancar de forma natural e informal. " +
              "5) \"em_blurb\": max 130 caracteres. Una linea, orientada AL EM, diciendo que quiere el founder de el. " +
              'Responde SOLO un JSON con este formato exacto: ' +
              '{"topic": string, "why": string[], "questions": string[], "opener": string, "em_blurb": string}.',
          },
          { role: "user", content: JSON.stringify({ founder: founderContext, experience_maker: emContext }) },
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OpenAI matching response was not valid JSON");
  }
  const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const clip = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const clipList = (v: unknown, cap: number, max: number) =>
    Array.isArray(v)
      ? v.map((item) => clip(item, max)).filter(Boolean).slice(0, cap)
      : [];
  const topic = clip(obj.topic);
  if (!topic) {
    throw new Error("OpenAI matching response missing a usable topic");
  }
  return {
    topic,
    opener: clip(obj.opener),
    why: clipList(obj.why, 3, 160),
    questions: clipList(obj.questions, 3, 200),
    em_blurb: clip(obj.em_blurb, 200),
  };
}

// Used when OpenAI is unavailable: a deterministic brief from tag overlap.
function fallbackMatchTopic(
  founder: MatchCandidatePerson,
  em: MatchCandidatePerson,
): MatchBrief {
  const founderTags = hasMeaningfulExpertiseTags(founder.expertise_tags) ? founder.expertise_tags : [];
  const emTags = hasMeaningfulExpertiseTags(em.expertise_tags) ? em.expertise_tags : [];
  const challengeTags = tagsFromChallengeSections(founder.startup?.challenges);
  const shared = Array.from(
    new Set([
      ...emTags.filter((t) => challengeTags.includes(t)),
      ...emTags.filter((t) => founderTags.includes(t)),
    ]),
  );
  const emFirstName = (em.full_name || "").trim().split(/\s+/)[0] || "este EM";
  const startupName = founder.startup?.name || "tu startup";
  const focus = shared.slice(0, 2).join(" y ") || "un reto que tienes ahora mismo";
  const topic =
    shared.length > 0
      ? `Habla con ${emFirstName} sobre ${shared.slice(0, 3).join(", ")}: es su area.`
      : `Contrasta tu reto actual con ${emFirstName}, tenéis expertise complementario.`;
  return {
    topic,
    opener: `Hola ${emFirstName}, estoy dándole vueltas a ${focus} y creo que tú has pasado por esto. ¿Tienes un momento en la próxima pausa?`,
    why:
      shared.length > 0
        ? [`Solapáis en: ${shared.slice(0, 3).join(", ")}`, `${emFirstName} ya ha trabajado en esa área`]
        : [`Expertise complementario para tu reto actual`],
    questions: [
      `¿Cómo abordaste ${shared[0] || "esto"} en tu experiencia?`,
      `¿Qué harías distinto si empezaras de cero?`,
      `¿Con quién más deberíamos hablar sobre esto?`,
    ],
    em_blurb: `${(founder.full_name || "Un founder").split(/\s+/)[0]} (${startupName}) quiere tu perspectiva sobre ${focus}.`,
  };
}

// Per-EM score multiplier (<= 1) derived from recent founder "useful" ratings.
// EMs with too few ratings are left untouched.
async function loadEmScoreMultipliers(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - MATCH_FEEDBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.match.findMany({
    where: { createdAt: { gte: since }, feedback: { not: Prisma.DbNull } },
    select: { em_id: true, feedback: true },
  });

  const tally = new Map<string, { useful: number; total: number }>();
  for (const row of rows) {
    const fb = row.feedback as { founder?: { useful?: unknown } } | null;
    const founderUseful = fb?.founder?.useful;
    if (typeof founderUseful !== "boolean") continue;
    const t = tally.get(row.em_id) ?? { useful: 0, total: 0 };
    t.total += 1;
    if (founderUseful) t.useful += 1;
    tally.set(row.em_id, t);
  }

  const multipliers = new Map<string, number>();
  for (const [emId, t] of tally) {
    if (t.total < MATCH_FEEDBACK_MIN_SAMPLES) continue;
    const rate = t.useful / t.total; // 0..1
    const mult =
      MATCH_FEEDBACK_MIN_MULTIPLIER + (1 - MATCH_FEEDBACK_MIN_MULTIPLIER) * rate;
    if (mult < 1) multipliers.set(emId, mult);
  }
  return multipliers;
}

// Repeated (founder, EM) pairs. Returns, per "founderId:emId" key:
//  - hardExcluded: matched within HARD_EXCLUDE_DAYS -> not a candidate today
//  - multiplier (<1): still cooling down (feedback useful:false cools slower;
//    useful:true carries no penalty and is omitted)
//  - priorCount: how many times this pair has been matched before (observability)
async function loadPairMultipliers(founderIds: string[], todayKey: string) {
  const multiplier = new Map<string, number>();
  const hardExcluded = new Set<string>();
  const priorCount = new Map<string, number>();
  if (founderIds.length === 0) return { multiplier, hardExcluded, priorCount };

  const rows = await prisma.match.findMany({
    where: { founder_id: { in: founderIds } },
    select: { founder_id: true, em_id: true, match_date: true, feedback: true },
    orderBy: { match_date: "asc" },
  });

  const todayMs = new Date(`${todayKey}T00:00:00.000Z`).getTime();
  const latest = new Map<string, { daysAgo: number; useful: unknown }>();
  for (const row of rows) {
    const key = `${row.founder_id}:${row.em_id}`;
    priorCount.set(key, (priorCount.get(key) ?? 0) + 1);
    const daysAgo = Math.floor((todayMs - new Date(row.match_date).getTime()) / 86400000);
    const fb = row.feedback as { founder?: { useful?: unknown } } | null;
    latest.set(key, { daysAgo, useful: fb?.founder?.useful });
  }

  for (const [key, info] of latest) {
    if (info.daysAgo <= MATCH_PAIR_HARD_EXCLUDE_DAYS) {
      hardExcluded.add(key);
      continue;
    }
    if (info.useful === true) continue; // "talk again" — compete on raw affinity
    const cooldown =
      info.useful === false ? MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS : MATCH_PAIR_COOLDOWN_DAYS;
    const mult = Math.min(1, info.daysAgo / cooldown);
    if (mult < 1) multiplier.set(key, mult);
  }

  return { multiplier, hardExcluded, priorCount };
}

type MatchSkip = { id: string; full_name: string; reason: string };
type MatchPlanEntry = {
  founder_id: string;
  founder: string;
  em_id: string;
  em: string;
  score: number;
  tag_score: number;
  text_score: number;
  weight: number;
  method: string;
  prior_matches: number;
};

// Never throws: any unexpected error is caught and returned as { ok: false }, so
// one bad day can't take down /jobs/run-all. Pass { dryRun: true } to compute the
// plan + skip reasons without writing any match/notification rows or generating
// topic text (embeddings are still resolved — cheap and cached).
async function runDailyMatchingJob(limit = 50, opts: { dryRun?: boolean } = {}) {
  const dryRun = opts.dryRun === true;
  try {
    const { founders, ems, todayKey, excludedFounders } = await loadMatchingPoolForToday();
    const foundersToProcess = founders.slice(0, limit);
    const base = {
      ok: true as const,
      dry_run: dryRun,
      today: todayKey,
      pool: { founders: founders.length, ems: ems.length, processed: foundersToProcess.length },
    };

    if (foundersToProcess.length === 0 || ems.length === 0) {
      return {
        ...base,
        em_capacity: 0,
        matched: 0,
        matched_via_fill: 0,
        failed: 0,
        skipped_already_matched: 0,
        skipped: excludedFounders as MatchSkip[],
        plan: [] as MatchPlanEntry[],
      };
    }

    const founderIds = foundersToProcess.map((f) => f.id);
    const [emMultiplier, pairInfo, founderNeedVecs, emOfferVecs] = await Promise.all([
      loadEmScoreMultipliers(),
      loadPairMultipliers(founderIds, todayKey),
      loadFounderNeedVectors(foundersToProcess),
      loadEmOfferVectors(ems),
    ]);
    const { multiplier: pairMultiplier, hardExcluded: hardExcludedPairs, priorCount: pairPriorCount } =
      pairInfo;
    const weightOf = (founderId: string, emId: string, score: number) =>
      score * (emMultiplier.get(emId) ?? 1) * (pairMultiplier.get(`${founderId}:${emId}`) ?? 1);

    // 1. Score every founder's candidate EMs. `score` = tag overlap + semantic
    //    similarity (both persisted as `score`); `weight` folds in the EM's recent
    //    "useful" feedback and the repeated-pair cooldown, and drives the
    //    assignment. Pairs matched in the last day are dropped (hardExcludedPairs).
    const shortlistByFounder = new Map<string, CandidateScore[]>();
    const scoreByPair = new Map<string, CandidateScore>();
    const edges: Array<{ founderId: string; emId: string; score: number; weight: number }> = [];
    for (const founder of foundersToProcess) {
      const shortlist = scoreCandidates(founder, ems, hardExcludedPairs, {
        founderNeedVec: founder.startup_id ? founderNeedVecs.get(founder.startup_id) : null,
        emOfferVecs,
      });
      shortlistByFounder.set(founder.id, shortlist);
      for (const c of shortlist) scoreByPair.set(`${founder.id}:${c.em.id}`, c);
      for (const { em, score } of shortlist) {
        edges.push({
          founderId: founder.id,
          emId: em.id,
          score,
          weight: weightOf(founder.id, em.id, score),
        });
      }
    }

    // 2. Global greedy assignment by weight: each founder gets <=1 EM, each EM gets
    //    <= capacity founders/day. A second pass at capacity+1 rescues founders who
    //    still have no slot, so nobody is left without a recommendation.
    const capacity = Math.min(
      MATCH_EM_DAILY_CAPACITY_CAP,
      Math.max(1, Math.ceil(foundersToProcess.length / ems.length)),
    );
    edges.sort(
      (a, b) =>
        b.weight - a.weight ||
        a.founderId.localeCompare(b.founderId) ||
        a.emId.localeCompare(b.emId),
    );

    const assignment = new Map<string, { emId: string; score: number; method: string }>();
    const emLoad = new Map<string, number>();
    const tryAssign = (
      edge: { founderId: string; emId: string; score: number; weight: number },
      method: string,
      cap: number,
    ) => {
      if (assignment.has(edge.founderId)) return;
      if ((emLoad.get(edge.emId) ?? 0) >= cap) return;
      assignment.set(edge.founderId, { emId: edge.emId, score: edge.score, method });
      emLoad.set(edge.emId, (emLoad.get(edge.emId) ?? 0) + 1);
    };
    for (const edge of edges) tryAssign(edge, "global_greedy", capacity);
    for (const edge of edges) tryAssign(edge, "global_fill", capacity + 1);

    // 2b. Quality floor: drop any assigned pair whose fit score (tag + text, no
    //     multipliers) is below MATCH_MIN_SCORE. Those founders get no match today
    //     — a "below_quality_floor" skip surfaced in the job result / ?dryRun=1 —
    //     instead of a filler recommendation the AI would then have to dress up.
    const flooredFounders = new Set<string>();
    for (const [founderId, chosen] of assignment) {
      if (chosen.score < MATCH_MIN_SCORE) flooredFounders.add(founderId);
    }
    for (const founderId of flooredFounders) assignment.delete(founderId);

    // Skip list: founders excluded from the pool + processed founders with no slot.
    const skipped: MatchSkip[] = [...excludedFounders];
    for (const founder of foundersToProcess) {
      if (assignment.has(founder.id)) continue;
      const hadCandidates = (shortlistByFounder.get(founder.id)?.length ?? 0) > 0;
      skipped.push({
        id: founder.id,
        full_name: founder.full_name,
        reason: flooredFounders.has(founder.id)
          ? "below_quality_floor"
          : hadCandidates
            ? "all_candidates_at_capacity"
            : "no_scoring_overlap",
      });
    }

    const emById = new Map(ems.map((em) => [em.id, em]));
    const founderById = new Map(foundersToProcess.map((f) => [f.id, f]));
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const plan: MatchPlanEntry[] = [];
    for (const [founderId, chosen] of assignment) {
      const founder = founderById.get(founderId);
      const em = emById.get(chosen.emId);
      if (!founder || !em) continue;
      const breakdown = scoreByPair.get(`${founderId}:${chosen.emId}`);
      plan.push({
        founder_id: founderId,
        founder: founder.full_name,
        em_id: chosen.emId,
        em: em.full_name,
        score: round2(chosen.score),
        tag_score: round2(breakdown?.tagScore ?? 0),
        text_score: round2(breakdown?.textScore ?? 0),
        weight: round2(weightOf(founderId, chosen.emId, chosen.score)),
        method: chosen.method,
        prior_matches: pairPriorCount.get(`${founderId}:${chosen.emId}`) ?? 0,
      });
    }
    plan.sort((a, b) => b.score - a.score);

    if (dryRun) {
      return { ...base, em_capacity: capacity, would_match: plan.length, plan, skipped };
    }

    // 3. Persist one Match + two notifications per assigned founder (atomically).
    let matched = 0;
    let matchedViaFill = 0;
    let failed = 0;
    let skippedAlreadyMatched = 0;
    const matchDate = new Date(`${todayKey}T00:00:00.000Z`);

    for (const founder of foundersToProcess) {
      const chosen = assignment.get(founder.id);
      if (!chosen) continue; // already recorded in `skipped`
      const em = emById.get(chosen.emId);
      if (!em) {
        failed += 1;
        continue;
      }

      try {
        let brief = fallbackMatchTopic(founder, em);
        let topicSource = "fallback";
        try {
          brief = await writeMatchTopic(founder, em);
          topicSource = "ai";
        } catch {
          // Keep the deterministic fallback brief.
        }
        const { topic, opener, why, questions, em_blurb: emBlurb } = brief;

        const shortlist = shortlistByFounder.get(founder.id) ?? [];
        const priorMatches = pairPriorCount.get(`${founder.id}:${em.id}`) ?? 0;
        const breakdown = scoreByPair.get(`${founder.id}:${em.id}`);

        await prisma.$transaction(async (tx) => {
          const createdMatch = await tx.match.create({
            data: {
              match_date: matchDate,
              founder_id: founder.id,
              em_id: em.id,
              startup_id: founder.startup_id,
              score: chosen.score,
              candidate_pool: shortlist
                .slice(0, MATCH_CANDIDATE_POOL_SIZE)
                .map((c) => ({
                  em_id: c.em.id,
                  score: Math.round(c.score * 100) / 100,
                  tag: c.tagScore,
                  text: Math.round(c.textScore * 100) / 100,
                })) as Prisma.InputJsonValue,
              selection_method: chosen.method,
              // reason_text holds the suggested conversation topic (headline shown in the UI).
              reason_text: topic,
              // opener lives here (no dedicated column yet); /matches/me reads it back.
              ai_raw_response: {
                topic,
                opener,
                why,
                questions,
                em_blurb: emBlurb,
                source: topicSource,
                prior_matches: priorMatches,
                score_breakdown: {
                  tag: breakdown?.tagScore ?? 0,
                  text: Math.round((breakdown?.textScore ?? 0) * 100) / 100,
                },
              } as Prisma.InputJsonValue,
            },
          });
          await tx.notification.createMany({
            data: [
              {
                id: crypto.randomUUID(),
                user_id: founder.id,
                message: MATCH_NOTIFICATION_TEXT,
                sent_at: new Date(),
                match_id: createdMatch.id,
              },
              {
                id: crypto.randomUUID(),
                user_id: em.id,
                message: MATCH_NOTIFICATION_TEXT,
                sent_at: new Date(),
                match_id: createdMatch.id,
              },
            ],
          });
        });

        matched += 1;
        if (chosen.method === "global_fill") matchedViaFill += 1;
      } catch (error) {
        // Unique(founder_id, match_date) race -> the founder already has today's match.
        if ((error as { code?: string })?.code === "P2002") skippedAlreadyMatched += 1;
        else failed += 1;
      }
    }

    return {
      ...base,
      em_capacity: capacity,
      matched,
      matched_via_fill: matchedViaFill,
      failed,
      skipped_already_matched: skippedAlreadyMatched,
      skipped,
    };
  } catch (error) {
    return {
      ok: false as const,
      dry_run: dryRun,
      error: error instanceof Error ? error.message : "Unknown matching job error",
    };
  }
}

// End-of-day reminder to rate today's match. Runs from the scheduler every tick
// but only acts after MATCH_FEEDBACK_REMINDER_HOUR (local), and only once per
// person per match — the sent timestamp is recorded under feedback.reminders so a
// later tick (or a restart) doesn't re-notify. One Notification per unrated side;
// the existing push dispatch delivers it. Never throws.
async function runMatchFeedbackReminders(now = new Date()) {
  try {
    const hour = hourInTimezone(now, MATCHING_TIMEZONE);
    if (hour === null || hour < MATCH_FEEDBACK_REMINDER_HOUR) {
      return { ok: true as const, skipped: "before_reminder_hour" as const, hour };
    }

    const todayKey = todayDateKey(MATCHING_TIMEZONE);
    const matches = await prisma.match.findMany({
      where: { match_date: new Date(`${todayKey}T00:00:00.000Z`) },
      select: {
        id: true,
        founder_id: true,
        em_id: true,
        feedback: true,
        founder: { select: { full_name: true } },
        em: { select: { full_name: true } },
      },
    });

    let created = 0;
    for (const match of matches) {
      const fb =
        match.feedback && typeof match.feedback === "object" && !Array.isArray(match.feedback)
          ? (match.feedback as Record<string, unknown>)
          : {};
      const reminders =
        fb.reminders && typeof fb.reminders === "object" && !Array.isArray(fb.reminders)
          ? (fb.reminders as Record<string, unknown>)
          : {};

      const sides: Array<{ role: "founder" | "em"; userId: string; counterpart: string }> = [
        { role: "founder", userId: match.founder_id, counterpart: match.em?.full_name || "tu Experience Maker" },
        { role: "em", userId: match.em_id, counterpart: match.founder?.full_name || "el founder" },
      ];

      const patch: Record<string, string> = {};
      for (const side of sides) {
        const roleFb = fb[side.role];
        const answered =
          roleFb && typeof roleFb === "object" && !Array.isArray(roleFb) && "talked" in (roleFb as object);
        if (answered || reminders[side.role]) continue;

        const firstName = side.counterpart.trim().split(/\s+/)[0] || side.counterpart;
        await prisma.notification.create({
          data: {
            id: crypto.randomUUID(),
            user_id: side.userId,
            message: `¿Hablaste hoy con ${firstName}? Cuéntanos qué tal, son 2 toques.`,
            sent_at: now,
            match_id: match.id,
          },
        });
        patch[side.role] = now.toISOString();
        created += 1;
      }

      if (Object.keys(patch).length > 0) {
        await prisma.match.update({
          where: { id: match.id },
          data: {
            feedback: { ...fb, reminders: { ...reminders, ...patch } } as Prisma.InputJsonValue,
          },
        });
      }
    }

    return { ok: true as const, created, checked: matches.length, hour };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Unknown feedback-reminder error",
    };
  }
}

// The full periodic job set. Driven both by POST /jobs/run-all (manual / external
// cron) and by an in-process interval (see the bottom of this file) — the backend
// is always up while a program runs, so it schedules its own jobs. Guarded so a
// slow run never overlaps the next tick; each sub-job is isolated so one failure
// doesn't skip the rest.
let scheduledJobsRunning = false;

async function runAllScheduledJobs(reason: string) {
  if (scheduledJobsRunning) {
    return { ok: true as const, reason, skipped: "already_running" as const };
  }
  scheduledJobsRunning = true;
  const ranAt = new Date();
  const safe = async (name: string, fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch (error) {
      return { error: error instanceof Error ? error.message : `${name} failed` };
    }
  };
  try {
    const reminders = await safe("reminders", () => triggerThirtyMinuteReminders(ranAt));
    const campaigns = await safe("campaigns", () => runScheduledCampaignDispatch(ranAt));
    const push = await safe("push", () => runPushDispatch(reason));
    const transcriptions = await safe("transcriptions", () => runOneOnOneTranscriptionJob(20));
    const teamTranscriptions = await safe("teamTranscriptions", () => runTeamNoteTranscriptionJob(20));
    const matching = await safe("matching", () => runDailyMatchingJob(50));
    const matchFeedbackReminders = await safe("matchFeedbackReminders", () =>
      runMatchFeedbackReminders(ranAt),
    );
    return {
      ok: true as const,
      reason,
      ran_at: ranAt,
      reminders,
      campaigns,
      push,
      transcriptions,
      teamTranscriptions,
      matching,
      matchFeedbackReminders,
    };
  } finally {
    scheduledJobsRunning = false;
  }
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

type MatchWithParties = Prisma.MatchGetPayload<{
  include: {
    founder: { select: typeof personSafeSelect };
    em: { select: typeof personSafeSelect };
  };
}>;

// Shape a Match row for one of its two participants: the counterpart's public
// info + the brief + this person's own feedback/connect state.
function serializeMatchForPerson(match: MatchWithParties, personId: string, opts: { stale?: boolean } = {}) {
  const isFounder = match.founder_id === personId;
  const counterpart = isFounder ? match.em : match.founder;
  const aiRaw =
    match.ai_raw_response && typeof match.ai_raw_response === "object" && !Array.isArray(match.ai_raw_response)
      ? (match.ai_raw_response as Record<string, unknown>)
      : {};
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const feedback =
    match.feedback && typeof match.feedback === "object" && !Array.isArray(match.feedback)
      ? (match.feedback as Record<string, unknown>)
      : {};
  const myFeedback = feedback[isFounder ? "founder" : "em"] ?? null;
  const connect =
    feedback.connect && typeof feedback.connect === "object" && !Array.isArray(feedback.connect)
      ? (feedback.connect as Record<string, unknown>)
      : {};

  return {
    id: match.id,
    match_date: match.match_date,
    reason_text: match.reason_text,
    opener: str(aiRaw.opener),
    why: strList(aiRaw.why),
    questions: strList(aiRaw.questions),
    em_blurb: str(aiRaw.em_blurb),
    my_feedback: myFeedback,
    my_connect: connect[isFounder ? "founder" : "em"] ?? null,
    stale: opts.stale === true,
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
  };
}

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
    const todayKey = todayDateKey(MATCHING_TIMEZONE);
    const todayMatchDate = new Date(`${todayKey}T00:00:00.000Z`);
    // Look back a few days so an evening conversation can still be rated the next
    // morning; anything still unrated in that window rides along as `pending`.
    const pendingSince = new Date(todayMatchDate);
    pendingSince.setUTCDate(pendingSince.getUTCDate() - MATCH_FEEDBACK_PENDING_DAYS);

    const rows = await prisma.match.findMany({
      where: {
        match_date: { gte: pendingSince, lte: todayMatchDate },
        OR: [{ founder_id: person.id }, { em_id: person.id }],
      },
      orderBy: { match_date: "desc" },
      include: {
        founder: { select: personSafeSelect },
        em: { select: personSafeSelect },
      },
    });

    const isToday = (m: MatchWithParties) => m.match_date.getTime() === todayMatchDate.getTime();
    const hasMyFeedback = (m: MatchWithParties) => {
      const fb =
        m.feedback && typeof m.feedback === "object" && !Array.isArray(m.feedback)
          ? (m.feedback as Record<string, unknown>)
          : {};
      const mine = fb[m.founder_id === person.id ? "founder" : "em"];
      return Boolean(mine && typeof mine === "object" && !Array.isArray(mine) && "talked" in (mine as object));
    };

    const todayRow = rows.find(isToday) ?? null;
    const pending = rows
      .filter((m) => !isToday(m) && !hasMyFeedback(m))
      .map((m) => serializeMatchForPerson(m, person.id, { stale: true }));

    res.json({
      match: todayRow ? serializeMatchForPerson(todayRow, person.id) : null,
      pending,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load match";
    res.status(500).json({ error: message });
  }
});

app.patch("/matches/:id/feedback", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid match id" });
    return;
  }
  const parsedBody = matchFeedbackSchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Invalid feedback payload" });
    return;
  }

  const person = await resolvePersonFromAuth(auth);
  if (!person) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  try {
    const match = await prisma.match.findUnique({
      where: { id: parsedId.data },
      select: { id: true, founder_id: true, em_id: true, feedback: true },
    });
    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }

    const role =
      match.founder_id === person.id ? "founder" : match.em_id === person.id ? "em" : null;
    if (!role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const current =
      match.feedback && typeof match.feedback === "object" && !Array.isArray(match.feedback)
        ? (match.feedback as Record<string, unknown>)
        : {};
    const { talked, takeaway, note } = parsedBody.data;
    const usefulFromTakeaway =
      takeaway === "nothing" ? false : takeaway ? true : parsedBody.data.useful ?? null;
    const mine = {
      talked,
      useful: talked ? usefulFromTakeaway : null,
      takeaway: talked ? takeaway ?? null : null,
      note: (note ?? "").trim().slice(0, 500) || null,
      at: new Date().toISOString(),
    };
    const next = { ...current, [role]: mine };

    await prisma.match.update({
      where: { id: match.id },
      data: { feedback: next as Prisma.InputJsonValue },
    });

    res.json({ ok: true, role, my_feedback: mine });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to save feedback" });
  }
});

// "Quiero hablar": ping the counterpart with a notification. Idempotent per role.
app.post("/matches/:id/connect", async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth?.email || !auth?.sub) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsedId = z.string().uuid().safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: "Invalid match id" });
    return;
  }
  const person = await resolvePersonFromAuth(auth);
  if (!person) {
    res.status(403).json({ error: "No person record linked to this email" });
    return;
  }

  try {
    const match = await prisma.match.findUnique({
      where: { id: parsedId.data },
      select: {
        id: true,
        founder_id: true,
        em_id: true,
        reason_text: true,
        feedback: true,
        founder: { select: { full_name: true, startup: { select: { name: true } } } },
        em: { select: { full_name: true } },
      },
    });
    if (!match) {
      res.status(404).json({ error: "Match not found" });
      return;
    }
    const role =
      match.founder_id === person.id ? "founder" : match.em_id === person.id ? "em" : null;
    if (!role) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const current =
      match.feedback && typeof match.feedback === "object" && !Array.isArray(match.feedback)
        ? (match.feedback as Record<string, unknown>)
        : {};
    const connect =
      current.connect && typeof current.connect === "object" && !Array.isArray(current.connect)
        ? (current.connect as Record<string, unknown>)
        : {};
    if (connect[role]) {
      res.json({ ok: true, already: true });
      return;
    }

    const targetUserId = role === "founder" ? match.em_id : match.founder_id;
    const meFirstName = (person.full_name || "Alguien").trim().split(/\s+/)[0];
    const startupName = match.founder?.startup?.name || "";
    const startupPart = role === "founder" && startupName ? ` (${startupName})` : "";
    const topicPart = match.reason_text ? ` sobre: ${match.reason_text}` : "";
    const message = `${meFirstName}${startupPart} quiere hablar contigo${topicPart}`;

    const at = new Date().toISOString();
    await prisma.$transaction(async (tx) => {
      await tx.match.update({
        where: { id: match.id },
        data: {
          feedback: { ...current, connect: { ...connect, [role]: at } } as Prisma.InputJsonValue,
        },
      });
      await tx.notification.create({
        data: {
          id: crypto.randomUUID(),
          user_id: targetUserId,
          message,
          sent_at: new Date(),
          match_id: match.id,
        },
      });
    });

    res.json({ ok: true, notified: role === "founder" ? match.em?.full_name : match.founder?.full_name });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to send connect ping" });
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
  const result = await runAllScheduledJobs("manual");
  res.json(result);
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
    const dryRun = ["1", "true", "yes"].includes(
      String(req.query.dryRun ?? req.query.dry_run ?? "").toLowerCase(),
    );
    const result = await runDailyMatchingJob(limit, { dryRun });
    res.status(result.ok ? 200 : 500).json(result);
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

// In-process cron: the backend runs the full job set (reminders, transcription,
// matching, plus push/campaigns again) every 5 minutes. No external scheduler —
// when a program ends, pausing this service stops the API and the jobs together.
const SCHEDULED_JOBS_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  runAllScheduledJobs("interval-5m").catch(() => {
    // Ignore to keep server alive.
  });
}, SCHEDULED_JOBS_INTERVAL_MS);
setTimeout(() => {
  runAllScheduledJobs("startup").catch(() => {
    // Ignore to keep server alive.
  });
}, 15000);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on http://localhost:${port}`);
});

