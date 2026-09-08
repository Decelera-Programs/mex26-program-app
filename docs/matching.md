# Daily founder ↔ experience-maker match

An **informal** nudge: once a day each participating founder (and each EM) is
suggested one person to catch informally — in a break or over lunch, no meeting
to book — and a concrete thing to talk about. It sits *alongside* the curated
1:1 event that the team schedules by hand; it does not touch or coordinate with
`OneOnOne` rows.

All logic lives in `backend/src/index.ts`. The UI is `src/components/MatchCard.jsx`
on Home.

## Daily pipeline (`runDailyMatchingJob`, `backend/src/index.ts`)

Runs from the 5-minute cron (`POST /jobs/run-all`) and standalone
(`POST /jobs/matching/run?limit=N`). Idempotent per day: a founder already
matched today is skipped, and `unique(match.founder_id, match_date)` is a backstop.

| # | Step | Function |
|---|---|---|
| 1 | **Pool** — people with `contact_type in (founder, experience_maker)`, present today (arrival ≤ today ≤ departure, in `America/Mexico_City`). Founders need meaningful `expertise_tags` **or** meaningful `startup.challenges`; EMs need meaningful `expertise_tags`. Founders already matched today are dropped. | `loadMatchingPoolForToday` |
| 2 | **Affinity score** — for each founder, derive `challengeTags` from their 1–2 worst‑rated `challenges.sections` (via `MATCH_SECTION_TO_TAGS`). For each EM: `score = 3·(EM tags ∩ challengeTags) + 1·(EM tags ∩ founder tags)`. Keep `score > 0`. Pairs matched in the last day are excluded here. | `scoreCandidates`, `topChallengeSections`, `tagsFromChallengeSections` |
| 3 | **Weight** — `weight = score · emMultiplier(EM) · pairMultiplier(founder,EM)`. `emMultiplier` dampens EMs founders keep rating unhelpful; `pairMultiplier` is the repeated‑pair cooldown. | `loadEmScoreMultipliers`, `loadPairMultipliers` |
| 4 | **Global assignment** — sort all edges by `weight` desc. Greedy pass: each founder ≤ 1 EM, each EM ≤ `capacity` founders/day where `capacity = min(4, ceil(#founders / #EMs))`. A second pass at `capacity + 1` (`global_fill`) rescues founders left with no slot. | `runDailyMatchingJob` step 2 |
| 5 | **Conversation text** — OpenAI (`gpt-4o-mini`) writes `{topic, opener}` for the already‑chosen pair. On any failure, a deterministic fallback from shared tags. | `writeMatchTopic`, `fallbackMatchTopic` |
| 6 | **Persist** — one `Match` row + two `Notification` rows (founder + EM, `message = topic`, linked by `match_id`). Push delivery is handled by the existing `runPushDispatch`. | `runDailyMatchingJob` step 3 |
| 7 | **Feedback** — `PATCH /matches/:id/feedback` writes back into `match.feedback`; feeds steps 3′ (EM reputation) and 3″ (pair cooldown) on later days. | `PATCH /matches/:id/feedback` |

The EM in step 4 is chosen **deterministically**. OpenAI only writes prose — it
never picks the person.

## Tunable constants (`backend/src/index.ts`)

| Constant | Default | Meaning |
|---|---|---|
| `MATCHING_TIMEZONE` | `America/Mexico_City` | "Today" + presence checks for the job. |
| `MATCH_WEIGHT_CHALLENGE` | `3` | Weight of an EM tag that matches a founder's weak challenge area. |
| `MATCH_WEIGHT_DIRECT_TAG` | `1` | Weight of an EM tag that matches a founder's own expertise tag. In practice founders rarely have `expertise_tags`, so this term is usually 0. |
| `MATCH_CHALLENGE_SEVERITY_THRESHOLD` | `2.5` | A challenge section is "a real problem" at this average rating (1–4). Sections at/above it (top 2) drive the tag mapping; if none qualify, the top 2 by average are used. |
| `MATCH_CANDIDATE_POOL_SIZE` | `10` | How many candidates are stored in `Match.candidate_pool` (analysis only; no longer limits the assignment). |
| `MATCH_EM_DAILY_CAPACITY_CAP` | `4` | Hard ceiling on founders per EM per day. Lower it if EMs feel swamped. |
| `MATCH_FEEDBACK_LOOKBACK_DAYS` | `14` | Window of feedback used for EM reputation. |
| `MATCH_FEEDBACK_MIN_SAMPLES` | `2` | Minimum founder "useful" ratings before an EM's score is dampened. |
| `MATCH_FEEDBACK_MIN_MULTIPLIER` | `0.4` | Floor of the EM multiplier (rate 0 → `0.4×`, rate 1 → `1.0×`). |
| `MATCH_PAIR_HARD_EXCLUDE_DAYS` | `1` | A pair matched within this many days is not a candidate today. |
| `MATCH_PAIR_COOLDOWN_DAYS` | `3` | Days for a repeated pair's multiplier to ramp back to `1.0×` (no / neutral feedback). |
| `MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS` | `10` | Same, when the founder last rated that pair `useful: false` — effectively "not again this program". |
| `OPENAI_MATCHING_MODEL` | env, `gpt-4o-mini` | Model for `writeMatchTopic`. |

### Multiplier curves

**EM reputation** (`loadEmScoreMultipliers`) — from `feedback.founder.useful` on
the EM's matches in the last `LOOKBACK_DAYS`, once there are `≥ MIN_SAMPLES`:

```
mult = 0.4 + 0.6 · (usefulCount / totalCount)      # 0.4×  … 1.0×
```

**Repeated pair** (`loadPairMultipliers`) — from the pair's most recent prior match:

| Last match… | Multiplier |
|---|---|
| ≤ 1 day ago | pair is hard‑excluded from today |
| rated `useful: true` | `1.0×` (no penalty — competes on raw affinity, i.e. depth is allowed) |
| rated `useful: false` | `min(1, daysAgo / 10)` |
| no / other feedback | `min(1, daysAgo / 3)` |

## Data model

`public.match` — one row per (founder, day). No `unique(founder_id, em_id)`
(pairs may repeat); `unique(founder_id, match_date)` still holds.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | pk |
| `match_date` | date | UTC‑midnight of the program day |
| `founder_id`, `em_id` | uuid | → `person.id` |
| `startup_id` | uuid null | founder's startup |
| `score` | float | **raw affinity** (step 2), not the weighted value |
| `candidate_pool` | jsonb | `[{ em_id, score }]`, top `MATCH_CANDIDATE_POOL_SIZE` by raw score |
| `selection_method` | text | `global_greedy` \| `global_fill` |
| `reason_text` | text | the `topic` (headline shown in the card) |
| `ai_raw_response` | jsonb null | `{ topic, opener, source: "ai"\|"fallback", prior_matches: number }` |
| `feedback` | jsonb null | `{ founder?: {talked, useful, at}, em?: {talked, useful, at} }` — added out of band, see below |
| `createdat` | timestamptz | |

`useful` is `true` \| `false` \| `null` (null = "we haven't talked yet" or "no
opinion"). `at` is an ISO timestamp.

## Endpoints

| Method / path | Auth | Purpose |
|---|---|---|
| `GET /matches/me` | Supabase bearer | The caller's match **for today** (or `{ match: null }`). Returns `role`, `counterpart`, `reason_text` (topic), `opener` (founders), `my_feedback`. |
| `PATCH /matches/:id/feedback` | Supabase bearer | Body `{ talked: boolean, useful?: boolean\|null }`. Caller must be the founder or EM of that match. Merges into `match.feedback[role]`. |
| `POST /jobs/matching/run?limit=N` | `x-job-key` | Run the job standalone (`N` = 1–200, default 50). |
| `POST /jobs/matching/run?dryRun=1` | `x-job-key` | **Preview**: runs pool → score → assignment and returns the plan + skip reasons **without writing anything or calling OpenAI**. Use it to sanity-check pairings before a program starts, and to tune. |
| `POST /jobs/run-all` | `x-job-key` | Cron entry point; runs matching (limit 50) among other jobs. |

`runDailyMatchingJob` never throws — on an unexpected error it returns `{ ok: false, error }`
(so one bad day can't take down `/jobs/run-all`).

Result shape:

```jsonc
{
  "ok": true,
  "dry_run": false,
  "today": "2026-11-10",
  "pool": { "founders": 20, "ems": 26, "processed": 20 },
  "em_capacity": 1,
  "matched": 18,
  "matched_via_fill": 2,
  "failed": 0,
  "skipped_already_matched": 0,
  "skipped": [ { "id": "...", "full_name": "...", "reason": "no_challenges_or_tags" } ]
  // dry run instead adds: "would_match", "plan": [ { founder, em, score, weight, method, prior_matches } ]
}
```

`skipped` reasons: `already_matched_today`, `not_present_today`, `no_challenges_or_tags`
(excluded from the pool), `no_scoring_overlap`, `all_candidates_at_capacity` (in the pool
but unmatched today).

## Observability

Everything needed to explain a day's matches is on the row:

- `selection_method` — was it a normal assignment or a `global_fill` rescue?
- `score` vs. the EM's position in `candidate_pool` — how strong was the affinity?
- `ai_raw_response.source` — did OpenAI write the text, or the fallback?
- `ai_raw_response.prior_matches` — is this a repeat pair, and how many times?
- `feedback` — what did each side report?

Example — today's matches with context (run in the Supabase SQL editor):

```sql
select
  m.match_date,
  f.full_name  as founder,
  e.full_name  as em,
  m.score,
  m.selection_method,
  m.ai_raw_response->>'source'        as text_source,
  m.ai_raw_response->>'prior_matches' as prior_matches,
  m.reason_text                       as topic,
  m.feedback
from public.match m
join public.person f on f.id = m.founder_id
join public.person e on e.id = m.em_id
where m.match_date = (current_date at time zone 'America/Mexico_City')::date
order by m.score desc;
```

EM load for a day:

```sql
select e.full_name, count(*) as founders_matched
from public.match m join public.person e on e.id = m.em_id
where m.match_date = (current_date at time zone 'America/Mexico_City')::date
group by e.full_name order by founders_matched desc;
```

## Tuning playbook

| Symptom | Lever |
|---|---|
| EMs report being swamped | Lower `MATCH_EM_DAILY_CAPACITY_CAP` (e.g. `3`). |
| Founders keep getting matched to the same few EMs | Shorten `MATCH_PAIR_COOLDOWN_DAYS` so more EMs stay eligible — or (better) check whether the tag data / `MATCH_SECTION_TO_TAGS` is too narrow. |
| A bad match keeps coming back | Confirm the founder submitted `useful: false`; `MATCH_PAIR_COOLDOWN_NOT_USEFUL_DAYS` (10) should hold it for the rest of a normal program. |
| Lots of `skipped` with `no_challenges_or_tags` / `no_scoring_overlap` | Pool too thin — usually missing `expertise_tags` on EMs or missing `challenges` on startups. Check the data, not the algorithm. |
| Topics feel generic | Improve `challenges.deep_dive` / `challenges.sections` data quality, or the system prompt in `writeMatchTopic`. |
| OpenAI down / `source: "fallback"` everywhere | Check `OPENAI_API_KEY`; the fallback text still works, it's just blander. |

## Schema changes made outside Prisma Migrate

This project applies schema changes directly in Supabase (see the root README).
Two changes support this feature and are **not** reproducible from a Prisma
migration — re‑apply them if the `public` schema is ever reset:

```sql
-- 1. per-role feedback on a match
alter table public.match add column if not exists feedback jsonb;
comment on column public.match.feedback is
  'Per-role feedback on the daily match. Shape: {"founder": {"talked": bool, "useful": bool|null, "at": timestamptz}, "em": {...}}. null = nobody answered yet.';

-- 2. let a (founder, EM) pair be re-matched later
alter table public.match drop constraint if exists match_founder_em_unique;
```

`schema.prisma` already reflects both (the `feedback Json?` field and the removed
`@@unique([founder_id, em_id])`).

## Known gaps

- **No coordination with the curated 1:1 event** (`OneOnOne`). The daily match can
  suggest a pair that already has a hand-scheduled 1:1. Deliberately deferred.
- Feedback questions show for both roles; "was it useful?" reads slightly oddly
  for an EM.
- EM reputation is global (aggregated across founders), because a given
  founder↔EM pair is rarely repeated within one program.
