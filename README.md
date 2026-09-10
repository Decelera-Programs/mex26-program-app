# Decelera México 2026 — Program PWA

Mobile-first Progressive Web App that accompanies attendees during the **Decelera México 2026**
bootcamp: personalized schedule, people & startups directory, in-app + push alerts, session
feedback, 1:1 meetings with audio capture, team audio notes, and an AI-generated
daily founder ↔ experience-maker match.

Forked from the Menorca 2026 app. Some venue-specific content (Logistics, InfoHub location card,
sponsors) still needs the real México data — those spots are marked with `TODO` comments.

## Architecture

```
React SPA (Vite)                     Express API (backend/)              Supabase
  src/api/dataService.js  ──HTTP──▶   src/index.ts  ──Prisma──▶          Postgres
  Bearer <supabase JWT>              verifies JWT via Supabase JWKS       Auth (email/password)
                                     web-push, OpenAI                     Storage (audio bucket)
```

- **Frontend**: React 19 + React Router 7 + Tailwind 4 + framer-motion. No mock mode — every screen
  reads real data from the backend through `src/api/dataService.js`.
- **Auth**: Supabase Auth. The client holds the session; the backend verifies the JWT on every
  request and resolves it to a `Person` row (by `user_id`, falling back to email with auto-link).
- **Backend**: single Express app (`backend/src/index.ts`) talking to Supabase Postgres via Prisma.
- **Scheduled work**: the backend runs the full job set on an in-process 5-minute interval (no
  external scheduler). `POST /jobs/run-all` triggers the same set on demand. See
  [Scheduled jobs](#scheduled-jobs).
- **Hosting**: Railway (frontend and backend as separate services).

## Repo layout

| Path | What |
|---|---|
| `src/App.jsx` | Route map (lazy-loaded pages) |
| `src/main.jsx` | Bootstrap + service worker registration (prod only) |
| `src/api/dataService.js` | The only data layer: fetch + auth header + response caching |
| `src/lib/supabaseClient.js` | Supabase browser client |
| `src/lib/apiBaseUrl.js` | Resolves `VITE_API_BASE_URL` |
| `src/lib/dateTime.js` | Event-time formatting (see [Time zones](#time-zones)) |
| `src/components/` | `Layout`, `RequireAuth`, `MatchCard`, `EventDetailsModal`, `PushNotificationPrompt`, … |
| `src/pages/` | Screen components |
| `src/index.css` + `tailwind.config.js` | Design tokens (Taviraj/Fustat fonts, cyan `#1FD0EF` accent) |
| `public/sw.js` | Service worker: offline shell + Web Push handlers |
| `public/manifest.webmanifest` | PWA metadata |
| `backend/src/index.ts` | Express server: all routes, jobs, matching, campaigns |
| `backend/src/db.ts` | Prisma client (adds pgbouncer params to `DATABASE_URL`) |
| `backend/src/jobs/notificationJobs.ts` | 30-minutes-before reminder job |
| `backend/prisma/schema.prisma` | DB models (introspected from Supabase) |
| `backend/prisma/migrations.legacy/` | Historical only — **not** applied by Prisma |

## Running locally

### Backend

```bash
cd backend
npm install
# create backend/.env (see "Environment variables" below)
npm run prisma:generate
npm run dev            # http://localhost:8787
```

### Frontend

```bash
npm install
# create .env at the repo root (see "Environment variables" below)
npm run dev            # http://localhost:5173
```

The frontend needs a reachable backend and a Supabase project; there is no offline/demo mode.

## Environment variables

### Frontend (`.env` at repo root)

| Var | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL (e.g. `http://localhost:8787`) |
| `VITE_SUPABASE_URL` | `https://<project>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_APP_URL` | Public app URL (used for auth redirects) |
| `VITE_SUPABASE_AUDIO_BUCKET` | Storage bucket for 1:1 / team audio (default `one-on-ones-audio`) |

### Backend (`backend/.env`)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres pooled connection string |
| `DIRECT_URL` | Direct (non-pooled) connection, for `prisma db pull` |
| `SUPABASE_URL` | Supabase project URL (JWKS + admin API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — first-access signup, Storage signed URLs |
| `PORT` | Defaults to `8787` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (generated in-memory if unset — dev only) |
| `JOBS_API_KEY` | Shared secret for `POST /jobs/*` (sent as `x-job-key`) |
| `CAMPAIGN_ADMIN_API_KEY` | Admin key for `/campaigns/*` (sent as `x-admin-key`) |
| `CAMPAIGN_ADMIN_EMAILS` | Comma-separated emails allowed to use `/campaigns/*` |
| `SUPABASE_AUDIO_BUCKET` | Storage bucket name (default `one-on-ones-audio`) |
| `OPENAI_API_KEY` | Audio transcription + AI matchmaking |
| `OPENAI_TRANSCRIPTION_MODEL` | Default `gpt-4o-mini-transcribe` |
| `OPENAI_MATCHING_MODEL` | Default `gpt-4o-mini` |

## Database & schema changes

The schema lives in **Supabase** and is **not** managed by Prisma Migrate. Apply changes directly
(SQL editor or the Supabase MCP), then refresh the local client:

```bash
cd backend
npm run prisma:pull      # prisma db pull — re-introspect schema.prisma
npm run prisma:generate
```

Do **not** run `prisma migrate dev|deploy` against this database. `backend/prisma/migrations.legacy/`
is deliberately not named `migrations` so the Prisma CLI ignores it.

Main models: `Event`, `Person` (carries many JSON survey fields), `Startup`, `UserEvent` (person↔event
join), `Notification`, `NotificationCampaign` (+ `NotificationCampaignRecipient`), `PushSubscription`,
`OneOnOne` (+ `OneOnOneAudioSubmission`), `TeamAudioNote`, `HumanDD`, `Match`, `HomeDailyContent`.

## API surface (backend)

Auth: `requireSupabaseAuth` validates the `Authorization: Bearer <jwt>` on all routes except
`/health`, `/auth/*`, `/push/public-key`, `/jobs/*` (use `x-job-key`) and `/campaigns/*` (use
`x-admin-key` or an allow-listed email).

- **Identity**: `GET /me`, `GET /auth/can-register`, `POST /auth/register-first-access`
- **Content**: `GET /events`, `GET /home-content`, `GET /people`, `GET /people/:id`,
  `GET /startups`, `GET /startups/:id`, `GET /events/:eventId/people`
- **Per-user**: `GET /users/:id/schedule`, `GET /users/:id/notifications`
  (+ `PATCH .../read`, `PATCH .../read-all`), `GET /matches/me`,
  `GET /one-on-ones/me` (+ `/audio`), `GET /team-notes/me` (+ `POST /team-notes`)
- **Feedback**: `GET|PUT /feedback/schedule/:dayKey`
- **Push**: `GET /push/public-key`, `POST /push/subscribe`, `POST /push/unsubscribe`
- **Campaigns (admin)**: `GET|POST /campaigns`, `POST /campaigns/preview`,
  `POST /campaigns/:id/send-now`, `GET /campaigns/:id/stats`
- **Jobs**: `POST /jobs/run-all`, `/jobs/notifications/30min`, `/jobs/notifications/push-dispatch`,
  `/jobs/campaigns/dispatch-due`, `/jobs/transcriptions/one-on-ones`,
  `/jobs/transcriptions/team-notes`, `/jobs/matching/run`

## Scheduled jobs

`runAllScheduledJobs` runs on an in-process `setInterval` every 5 minutes (plus once
~15 s after boot). `POST /jobs/run-all` (auth: `x-job-key`, or open if `JOBS_API_KEY`
is unset) runs the exact same set on demand. Runs are guarded against overlap, and
each sub-job is isolated so one failure doesn't skip the rest. The set:

1. **30-min reminders** — `Notification` rows for events starting soon.
2. **Scheduled campaigns** — dispatch campaigns whose `scheduled_for` is due.
3. **Push dispatch** — deliver Web Push for `Notification`s past their `sent_at`.
   (Also runs on a 30s interval inside the server.)
4. **1:1 / team-note transcription** — download audio from Storage → OpenAI → save transcript.
5. **Daily matching** — one informal founder ↔ experience-maker suggestion per person per day:
   affinity-score every candidate EM, then a global assignment (per-EM daily capacity, repeated-pair
   cooldown, feedback-weighted), then OpenAI writes the conversation topic + opener for the chosen
   pair. Creates a `Match` + two `Notification`s. Full design: [`docs/matching.md`](docs/matching.md).

## Time zones

The program runs in Mexico. **Event schedule times are floating wall-clock values** — whatever is
stored in the DB is shown verbatim to every attendee regardless of their device timezone. Enter the
published México schedule as-is; no offset math. `src/lib/dateTime.js` intentionally does not apply a
timezone when formatting event times.

"What day is it now" / on-site presence checks resolve against `America/Mexico_City`
(`PROGRAM_TIMEZONE` on the frontend, `AUDIENCE_TIMEZONE` / `MATCHING_TIMEZONE` on the backend).

## PWA & offline

- `public/manifest.webmanifest` — installability.
- `public/sw.js` — network-first for navigations (fallback to cached shell), cache-first for
  same-origin assets, plus `push` / `notificationclick` handlers. Bump `CACHE_NAME` to force an
  update. Registered from `src/main.jsx` on load in production builds only.

## Scripts

**Frontend (repo root)**: `npm run dev` · `npm run build` · `npm run preview` · `npm run lint`

**Backend (`backend/`)**: `npm run dev` (tsx watch) · `npm run build` (`prisma generate && tsc`) ·
`npm run start` (compiled) · `npm run prisma:generate` · `npm run prisma:pull` · `npm run prisma:studio`

## Where do I change…?

| Task | Place |
|---|---|
| Program start date / hero fallback | `src/pages/Home.jsx` (`PROGRAM_START_DATE`, `FALLBACK_HERO_CONTENT`) |
| Daily hero / podcast content | `HomeDailyContent` table (per date) |
| Venue / logistics | `src/pages/Logistics.jsx`, `src/pages/InfoHub.jsx` (marked `TODO`) |
| Sponsors | `src/pages/Home.jsx` (`SPONSORS`, currently empty) |
| Routes | `src/App.jsx` |
| Bottom nav | `src/components/Layout.jsx` |
| Theme tokens | `src/index.css`, `tailwind.config.js` |
