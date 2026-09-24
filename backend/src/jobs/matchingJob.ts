import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { dateKeyInTimezone, todayDateKey, hourInTimezone } from "../lib/dateTime.js";
import { personSafeSelect } from "../lib/personSelect.js";

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_MATCHING_MODEL = (process.env.OPENAI_MATCHING_MODEL || "gpt-4o-mini").trim();
const OPENAI_EMBEDDING_MODEL = (process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small").trim();

// Founder<->Experience Maker daily matching runs in the program's timezone.
export const MATCHING_TIMEZONE = "America/Mexico_City";
const MATCH_CANDIDATE_POOL_SIZE = 10;
export const MATCH_WEIGHT_CHALLENGE = 3;
export const MATCH_WEIGHT_DIRECT_TAG = 1;
// Semantic term: cosine similarity between the founder's stated need
// (challenge_name + expertise_wanted + top sections) and the EM's profile
// (tagline + expertise_tags + bio), rescaled from [SIM_MIN, SIM_MAX] to [0, 1]
// and worth up to MATCH_WEIGHT_TEXT "tag points". The tag-overlap score stays as
// a floor; this only adds. If OPENAI_API_KEY is unset the term is simply 0.
export const MATCH_WEIGHT_TEXT = 8;
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
export const MATCH_MIN_SCORE = 2.0;
// Hard ceiling on how many founders one EM can be matched with in a single day.
export const MATCH_EM_DAILY_CAPACITY_CAP = 4;
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

// After a match, in up to three quick taps:
//   1. talked:  "yes" | "not_yet" (ask me later) | "wont" (couldn't / won't happen)
//   2. rating (only when talked = "yes"):  "great" | "good" | "meh"
//   3. takeaway (optional, only when rating is great/good)
// `useful` is derived from `rating` (great/good -> true, meh -> false) and kept on
// the stored object for the EM-reputation and pair-cooldown consumers.
export const matchFeedbackSchema = z
  .object({
    talked: z.enum(["yes", "not_yet", "wont"]),
    rating: z.enum(["great", "good", "meh"]).nullable().optional(),
    takeaway: z.enum(["idea", "contact", "perspective", "collab"]).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict();

// True / false / null "was this useful to the founder", rating-aware with a
// fallback to the older boolean `useful` field on pre-existing rows.
function founderRatingUseful(
  fb: { founder?: { rating?: unknown; useful?: unknown } } | null | undefined,
): boolean | null {
  const r = fb?.founder?.rating;
  if (r === "great" || r === "good") return true;
  if (r === "meh") return false;
  const u = fb?.founder?.useful;
  return typeof u === "boolean" ? u : null;
}

// One side's feedback is "settled" only when they said yes (rated it) or "wont".
// "not_yet" (ask me later) and no answer keep the reminder + pending card alive.
export function feedbackIsSettled(roleFb: unknown): boolean {
  if (!roleFb || typeof roleFb !== "object" || Array.isArray(roleFb)) return false;
  const t = (roleFb as { talked?: unknown }).talked;
  return t === "yes" || t === "wont" || t === true; // `true` = pre-enum rows
}

// EM-level reputation: EMs that founders repeatedly find unhelpful get their
// match scores dampened. Needs a minimum sample size so one bad rating can't
// sink an EM, and a lookback so old feedback fades.
const MATCH_FEEDBACK_LOOKBACK_DAYS = 14;
const MATCH_FEEDBACK_MIN_SAMPLES = 2;
const MATCH_FEEDBACK_MIN_MULTIPLIER = 0.4;

// Repeated (founder, EM) pairs: instead of a hard ban, dampen the score and let
// it recover over a cooldown. A pair matched within HARD_EXCLUDE_DAYS is skipped
// outright; a pair the founder last rated "meh" cools down much slower; a pair
// the founder said "won't happen" gets a medium cooldown (real signal, but not a
// quality rejection); a pair rated useful carries no penalty.
const MATCH_PAIR_HARD_EXCLUDE_DAYS = 1;
const MATCH_PAIR_COOLDOWN_DAYS = 3;
const MATCH_PAIR_COOLDOWN_WONT_DAYS = 7;
const MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS = 10;

// End-of-day nudge to rate the day's match. runMatchFeedbackReminders only fires
// once the local hour in MATCHING_TIMEZONE reaches this, and sends at most one
// reminder per person per match (tracked in match.feedback.reminders).
const MATCH_FEEDBACK_REMINDER_HOUR = 20;
// How long a match with no feedback keeps surfacing on /matches/me as a "pending"
// card, so an evening conversation still gets rated the next morning.
export const MATCH_FEEDBACK_PENDING_DAYS = 2;
// Push/notification copy for a fresh daily match. Deliberately a teaser — the
// details (counterpart, topic, questions) live on the card the user opens.
const MATCH_NOTIFICATION_TEXT = "We've got a suggestion you might like!";

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

export type MatchCandidatePerson = {
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

export type CandidateScore = {
  em: MatchCandidatePerson;
  score: number;
  tagScore: number;
  textScore: number;
};

export function scoreCandidates(
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
              "You are the informal-connections assistant for the Decelera Mexico 2026 program. " +
              "You are given a founder with a live challenge and an experience maker they are ALREADY paired with for today. " +
              "The founder should talk to them informally (in a break or over a meal, WITHOUT booking a meeting) " +
              "for a short, useful conversation. Write everything in English, concrete, nothing generic, anchored in the " +
              "founder's real challenge and in something specific about that EM's expertise or experience. Produce: " +
              "1) \"topic\": max 140 characters. ONE actionable thing to talk about. " +
              "2) \"why\": array of 2 or 3 strings, max 110 characters each. Why this pairing makes sense " +
              "(cite the founder's challenge and something concrete about the EM). " +
              "3) \"questions\": array of EXACTLY 3 strings, max 130 characters each. Concrete questions " +
              "the founder can ask them, anchored in the challenge. " +
              "4) \"opener\": max 150 characters. A first-person line the founder can say verbatim " +
              "to start naturally and informally. " +
              "5) \"em_blurb\": max 130 characters. One line, aimed AT the EM, saying what the founder wants from them. " +
              'Respond with ONLY a JSON object in exactly this shape: ' +
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
  const emFirstName = (em.full_name || "").trim().split(/\s+/)[0] || "this EM";
  const startupName = founder.startup?.name || "your startup";
  const focus = shared.slice(0, 2).join(" and ") || "a challenge you're facing right now";
  const topic =
    shared.length > 0
      ? `Talk to ${emFirstName} about ${shared.slice(0, 3).join(", ")}: it's their area.`
      : `Compare notes on your current challenge with ${emFirstName} — your expertise is complementary.`;
  return {
    topic,
    opener: `Hi ${emFirstName}, I've been chewing on ${focus} and I think you've been through this. Got a minute at the next break?`,
    why:
      shared.length > 0
        ? [`You overlap on: ${shared.slice(0, 3).join(", ")}`, `${emFirstName} has already worked in that area`]
        : [`Complementary expertise for your current challenge`],
    questions: [
      `How did you approach ${shared[0] || "this"} in your own experience?`,
      `What would you do differently if you started from scratch?`,
      `Who else should we be talking to about this?`,
    ],
    em_blurb: `${(founder.full_name || "A founder").split(/\s+/)[0]} (${startupName}) wants your perspective on ${focus}.`,
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

  const tally = new Map<string, { score: number; total: number }>();
  for (const row of rows) {
    const fb = row.feedback as { founder?: { rating?: unknown; useful?: unknown } } | null;
    const r = fb?.founder?.rating;
    let score: number | null =
      r === "great" ? 1 : r === "good" ? 0.6 : r === "meh" ? 0 : null;
    if (score === null) {
      // Pre-rating rows only carried a boolean `useful`.
      const u = fb?.founder?.useful;
      if (typeof u === "boolean") score = u ? 0.8 : 0;
    }
    if (score === null) continue;
    const t = tally.get(row.em_id) ?? { score: 0, total: 0 };
    t.total += 1;
    t.score += score;
    tally.set(row.em_id, t);
  }

  const multipliers = new Map<string, number>();
  for (const [emId, t] of tally) {
    if (t.total < MATCH_FEEDBACK_MIN_SAMPLES) continue;
    const rate = t.score / t.total; // 0..1
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
  const latest = new Map<string, { daysAgo: number; useful: boolean | null; talked: unknown }>();
  for (const row of rows) {
    const key = `${row.founder_id}:${row.em_id}`;
    priorCount.set(key, (priorCount.get(key) ?? 0) + 1);
    const daysAgo = Math.floor((todayMs - new Date(row.match_date).getTime()) / 86400000);
    const fb = row.feedback as { founder?: { rating?: unknown; useful?: unknown; talked?: unknown } } | null;
    latest.set(key, { daysAgo, useful: founderRatingUseful(fb), talked: fb?.founder?.talked });
  }

  for (const [key, info] of latest) {
    if (info.daysAgo <= MATCH_PAIR_HARD_EXCLUDE_DAYS) {
      hardExcluded.add(key);
      continue;
    }
    if (info.useful === true) continue; // "talk again" — compete on raw affinity
    const cooldown =
      info.useful === false
        ? MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS
        : info.talked === "wont"
          ? MATCH_PAIR_COOLDOWN_WONT_DAYS
          : MATCH_PAIR_COOLDOWN_DAYS;
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

export type MatchEdge = { founderId: string; emId: string; score: number; weight: number };
export type MatchAssignment = { emId: string; score: number; method: string };

// Greedy bipartite-ish assignment by weight: each founder gets <=1 EM, each EM
// gets <= capacity founders/day ("global_greedy"). A second pass at capacity+1
// rescues founders who still have no slot ("global_fill"), so nobody is left
// without a recommendation. Pure and deterministic given its inputs — ties break
// on founderId/emId so the result doesn't depend on edge order.
export function assignFoundersToEms(edges: MatchEdge[], capacity: number): Map<string, MatchAssignment> {
  const sorted = [...edges].sort(
    (a, b) =>
      b.weight - a.weight ||
      a.founderId.localeCompare(b.founderId) ||
      a.emId.localeCompare(b.emId),
  );

  const assignment = new Map<string, MatchAssignment>();
  const emLoad = new Map<string, number>();
  const tryAssign = (edge: MatchEdge, method: string, cap: number) => {
    if (assignment.has(edge.founderId)) return;
    if ((emLoad.get(edge.emId) ?? 0) >= cap) return;
    assignment.set(edge.founderId, { emId: edge.emId, score: edge.score, method });
    emLoad.set(edge.emId, (emLoad.get(edge.emId) ?? 0) + 1);
  };
  for (const edge of sorted) tryAssign(edge, "global_greedy", capacity);
  for (const edge of sorted) tryAssign(edge, "global_fill", capacity + 1);
  return assignment;
}

// Never throws: any unexpected error is caught and returned as { ok: false }, so
// one bad day can't take down /jobs/run-all. Pass { dryRun: true } to compute the
// plan + skip reasons without writing any match/notification rows or generating
// topic text (embeddings are still resolved — cheap and cached).
export async function runDailyMatchingJob(limit = 50, opts: { dryRun?: boolean } = {}) {
  const dryRun = opts.dryRun === true;
  try {
    // Cheap precheck before loading the pool (every person's embedding, ~MBs):
    // this runs every 5 minutes, and once every founder has today's match
    // there's nothing to do until tomorrow.
    if (!dryRun) {
      const todayMatchDate = new Date(`${todayDateKey(MATCHING_TIMEZONE)}T00:00:00.000Z`);
      const [founderCount, matchedToday] = await Promise.all([
        prisma.person.count({ where: { contact_type: "founder" } }),
        prisma.match.count({ where: { match_date: todayMatchDate } }),
      ]);
      if (founderCount === 0 || matchedToday >= founderCount) {
        return { ok: true as const, dry_run: false, skipped: "all_matched_today" as const, matched: 0 };
      }
    }

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
    const assignment = assignFoundersToEms(edges, capacity);

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
                  // The raw `score` column is tag+text only; `weight` is what actually
                  // drove the assignment (EM reputation multiplier * pair cooldown
                  // multiplier folded in) — kept here so a later "why this EM and not
                  // that one" question doesn't need the job re-run to answer.
                  weight: round2(weightOf(founder.id, em.id, chosen.score)),
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
export async function runMatchFeedbackReminders(now = new Date()) {
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
        { role: "founder", userId: match.founder_id, counterpart: match.em?.full_name || "your Experience Maker" },
        { role: "em", userId: match.em_id, counterpart: match.founder?.full_name || "the founder" },
      ];

      const patch: Record<string, string> = {};
      for (const side of sides) {
        if (feedbackIsSettled(fb[side.role]) || reminders[side.role]) continue;

        const firstName = side.counterpart.trim().split(/\s+/)[0] || side.counterpart;
        await prisma.notification.create({
          data: {
            id: crypto.randomUUID(),
            user_id: side.userId,
            message: `Did you catch up with ${firstName} today? Tell us how it went — 2 taps.`,
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

export type MatchWithParties = Prisma.MatchGetPayload<{
  include: {
    founder: { select: typeof personSafeSelect };
    em: { select: typeof personSafeSelect };
  };
}>;

// Shape a Match row for one of its two participants: the counterpart's public
// info + the brief + this person's own feedback/connect state.
export function serializeMatchForPerson(
  match: MatchWithParties,
  personId: string,
  opts: { stale?: boolean } = {},
) {
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
