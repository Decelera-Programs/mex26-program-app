# Menorca 2026 PWA

Mobile-first Progressive Web App for the **Decelera Menorca 2026** bootcamp: personal schedule, master program, people & startups directory, and in-app alerts.

## TL;DR (how to run it)

- **Just want the app running (no backend, works offline)**:

```bash
npm install
npm run dev
```

- **Want the real database + API too**:

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:generate
npm run dev
```

```bash
cd ..
npm install
npm run dev
```

> **Schema changes do not go through Prisma Migrate.** The database (Supabase) is managed directly — schema changes are applied there (SQL editor / Supabase MCP), never via `prisma migrate dev|deploy` against this project's database. After any schema change, run `npm run prisma:pull` (`prisma db pull`) in `backend/` to refresh `schema.prisma`, then `npm run prisma:generate`. `backend/prisma/migrations.legacy/` is kept only for historical reference and is intentionally not named `migrations` so Prisma CLI won't pick it up.

## Two modes (pick one)

| Mode | When to use | What powers the UI |
|---|---|---|
| **Mock mode (default)** | Demos, fast iteration, offline | `src/api/dataService.js` → `src/data/mockData.js` |
| **Backend mode (optional)** | Real data, multi-user, persistence | `backend/` (Express + Prisma + SQLite) |

This repo is a **full-stack** setup:
- **Frontend**: React + Vite + React Router + Tailwind.
- **Backend (optional / included)**: Express + Prisma (SQLite) with endpoints for the same entities the UI expects.

## What’s “done” (high-level)

- **User logic (what the user experiences)**:
  - Welcome splash (`/`) → auto-navigates to the app (`/home`)
  - Bottom navigation (Home / Schedule / Alerts / Info)
  - “Schedule” and “Alerts” are **personalized** for the current user
- **Business logic (rules behind the screens)**:
  - Your **personal schedule** = “events assigned to you” (a user↔event join)
  - Alerts can be **marked read**
    - In mock mode: read/unread is persisted in `localStorage`
    - In backend mode: notifications live in the DB
- **Dataframe / data layer (where data comes from)**:
  - Pages call `src/api/dataService.js`
  - In mock mode that file reads from `src/data/mockData.js`
  - Backend mirrors the same concepts via DB + API when you switch later

## Mental model (how data moves)

Mock mode today:

```text
Pages (src/pages/*)
  -> hooks (src/hooks/*)
    -> dataService (src/api/dataService.js)
      -> mockData "dataframe" (src/data/mockData.js)
        -> UI renders
```

Backend mode later (suggested):

```text
Pages -> hooks -> dataService
  -> fetch() -> backend (Express routes)
    -> Prisma -> SQLite
```

## Tech stack

- **Frontend**
  - Vite, React, React Router
  - Tailwind CSS (token-based theme in `src/index.css`)
  - framer-motion (animations), moment (date formatting), lucide-react (icons)
  - Simple Service Worker + manifest for PWA
- **Backend**
  - Express + CORS
  - Prisma + SQLite
  - zod validation
  - A sample “30 min reminder” job endpoint

## Repo structure (where to look)

- **Frontend**
  - `src/main.jsx`: app bootstrap + service worker registration
  - `src/App.jsx`: route map (React Router)
  - `src/components/`: reusable UI blocks (cards, layout shell)
  - `src/pages/`: screen-level pages (Schedule, People, Startups, etc.)
  - `src/api/dataService.js`: **frontend data layer** (currently mock-backed)
  - `src/data/mockData.js`: the “dataframe” (entities in arrays)
  - `src/hooks/useUserSchedule.js`: example of page-level orchestration of user + schedule data
  - `tailwind.config.js` + `src/index.css`: design tokens + theme
- **PWA**
  - `public/sw.js`: offline caching strategy (minimal, same-origin only)
  - `public/manifest.webmanifest`: PWA metadata
- **Backend**
  - `backend/src/index.ts`: Express server + API endpoints
  - `backend/prisma/schema.prisma`: DB models (Event, Person, Startup, UserEvent, Notification)
  - `backend/src/jobs/notificationJobs.ts`: notification creation logic (“30 min before” reminders)
  - `backend/.env.example`: environment variables template

## Quickstart (frontend only — mock mode, default)

From the repo root:

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

**What to click first**
- **Home**: general overview
- **Schedule**: your personal agenda
- **Alerts**: notifications
- **Info**: logistics / media kit pages

## Quickstart (full-stack — backend + frontend)

### 1) Start the backend

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Backend defaults to `http://localhost:8787` and exposes:
- `GET /health`
- `GET /people?q=...`
- `GET /startups?q=...`
- `GET /events`
- `GET /users/:userId/schedule`
- `GET /users/:userId/notifications?unread=true|false`
- `POST /jobs/notifications/30min` (creates upcoming reminders)

### 2) Start the frontend

In another terminal:

```bash
npm install
npm run dev
```

### Wiring frontend → backend (current state)

The UI is currently served by mock-backed functions in `src/api/dataService.js`.

To connect the backend:
- Keep the same exported functions (so pages don’t change)
- Replace their internals with `fetch()` calls to the endpoints listed above
- Return the same “shape” the UI expects (especially date fields)

## Data model (business “entities”)

The app is built around a small set of entities.

### Frontend (mock mode)

Defined in `src/data/mockData.js`:
- **Event**: `id`, `title`, `start_time`, `end_time`, `location`, `type`
- **Startup**: `id`, `name`, `tagline`, `description`, etc.
- **Person**: `id`, `full_name`, `person_type`, `expertise_tags`, optional `startup_id`
- **UserEvent**: join between a user (email) and an event id
- **Notification**: per-user alert items; includes `created_date` for “time ago”

### Backend (DB mode)

Defined in `backend/prisma/schema.prisma`:
- **Event** (master program)
- **Person** (attendees/mentors/team)
- **Startup**
- **UserEvent** (join table: person ↔ event)
- **Notification** (in-app alerts; optional event link)

Note: the backend stores `expertise_tags` as a JSON string for SQLite portability.

## Dataflow (from “dataframe” → React UI)

### The “dataframe” concept in this repo

Think of `src/api/dataService.js` as the **single source of truth** for the UI: pages call it for data; components render the results. In mock mode it reads from `src/data/mockData.js` (arrays).

### Example: Personal schedule

- In `src/hooks/useUserSchedule.js`:
  - `getCurrentUser()` decides “who am I?”
  - `listUserScheduleEvents(me.email)` returns the events assigned to that user
- In `src/api/dataService.js`:
  - `listUserScheduleEvents()` joins `MOCK_USER_EVENTS` ↔ `MOCK_EVENTS` and sorts by time
- In `src/pages/Schedule.jsx`:
  - groups by day and renders cards + detail links

### Example: Notifications read/unread

- `listNotificationsForUser(userEmail)`:
  - loads a `localStorage` map (key `menorca.notificationReadMap.v1`)
  - merges it onto notifications so “read” survives refresh
- `markNotificationRead()` / `markAllNotificationsReadForUser()` update that map

## User flows (what the user can do)

- **Welcome → app**: `src/pages/Welcome.jsx` navigates to `/home` after a short splash.
- **Navigate**: bottom navigation in `src/components/Layout.jsx`.
- **Schedule**: see your assigned events by day, switch view mode, open an event detail page.
- **People / Startups**: browse directories and open detail pages.
- **Alerts**: view notifications and mark them read (mock mode persists read state locally).
- **Info**: hub pages for logistics / media kit, etc.

## PWA & offline behavior

- `public/manifest.webmanifest` enables installability.
- `public/sw.js` provides a minimal offline strategy:
  - **Network-first** for navigations (SPA routes), fallback to cached `/`
  - **Cache-first** for same-origin static assets
- Service worker is registered in `src/main.jsx` on window load (and failures are ignored in dev).

## Useful scripts

### Frontend (repo root)

- `npm run dev`: run the Vite dev server
- `npm run build`: production build
- `npm run preview`: preview the production build locally
- `npm run lint`: run ESLint

### Backend (`backend/`)

- `npm run dev`: run Express server with TS watch (`tsx`)
- `npm run build`: TypeScript compile
- `npm run start`: run compiled server from `dist/`
- `npm run prisma:generate`: generate Prisma client from `schema.prisma`
- `npm run prisma:pull`: re-introspect `schema.prisma` from the live database (run after any schema change made in Supabase)
- `npm run prisma:studio`: open Prisma Studio

## “Where do I change…?” (fast pointers)

- **Bootcamp program items (events)**: `src/data/mockData.js` → `MOCK_EVENTS`
- **People directory**: `src/data/mockData.js` → `MOCK_PEOPLE`
- **Startups directory**: `src/data/mockData.js` → `MOCK_STARTUPS`
- **Who sees which events on Schedule**: `src/data/mockData.js` → `MOCK_USER_EVENTS`
- **Alerts content**: `src/data/mockData.js` → `MOCK_NOTIFICATIONS`
- **Who is the “current user”**: `src/api/dataService.js` → `getCurrentUser()`
- **Routes / URLs**: `src/App.jsx`
- **Bottom navigation**: `src/components/Layout.jsx`
- **Theme colors / fonts**: `src/index.css` and `tailwind.config.js`

## Common dev tasks

### Update bootcamp content (events/people/startups)

Edit `src/data/mockData.js`:
- add/edit entries in `MOCK_EVENTS`, `MOCK_PEOPLE`, `MOCK_STARTUPS`
- adjust `MOCK_USER_EVENTS` to change what appears in a user’s personal schedule
- adjust `MOCK_NOTIFICATIONS` to test alerts UX

### Simulate a different “current user”

In `src/api/dataService.js`, change `getCurrentUser()`:
- return a different person from `MOCK_PEOPLE`
- or return `null` to trigger the “not registered” UX in schedule

### Move from mock mode to backend mode (suggested approach)

1) Keep the public API of `src/api/dataService.js` the same (pages shouldn’t change).
2) Swap implementations to call backend endpoints (`fetch("http://localhost:8787/...")`).
3) Ensure the returned objects match what pages expect (especially date fields and notification fields).

## Troubleshooting

- **PWA cache looks “stuck”**: service workers cache aggressively. In the browser devtools, unregister the SW / clear site data, then reload.
- **Backend DB issues**: confirm `backend/.env` exists and `DATABASE_URL` points at the right Supabase project; if `schema.prisma` looks out of date, run `npm run prisma:pull && npm run prisma:generate`. Do not run `prisma migrate dev|deploy` against this database — schema changes are made directly in Supabase (see Quickstart note above).
- **CORS**: backend enables CORS broadly; if you lock this down later, ensure the frontend origin is allowed.
