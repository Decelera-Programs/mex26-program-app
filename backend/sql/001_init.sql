-- SQL migration (Postgres-flavored) matching the Prisma schema.
-- If you deploy on Postgres, use this as a starting point (adjust extensions/timezones as needed).

-- EventType enum
DO $$ BEGIN
  CREATE TYPE event_type AS ENUM (
    'workshop',
    'talk',
    'networking',
    'meal',
    'activity',
    'ceremony',
    'mentoring',
    'free_time'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS startup (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  tagline     text,
  sector      text,
  stage       text,
  logo_url    text,
  website_url text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS startup_name_idx ON startup (name);

CREATE TABLE IF NOT EXISTS person (
  id             text PRIMARY KEY,
  full_name      text NOT NULL,
  bio            text,
  photo_url      text,
  linkedin_url   text,
  company_name   text,
  expertise_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  startup_id     text REFERENCES startup (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS person_startup_id_idx ON person (startup_id);
CREATE INDEX IF NOT EXISTS person_full_name_idx ON person (full_name);

CREATE TABLE IF NOT EXISTS event (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  description text,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  location    text NOT NULL,
  type        event_type NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_start_time_idx ON event (start_time);
CREATE INDEX IF NOT EXISTS event_type_idx ON event (type);

CREATE TABLE IF NOT EXISTS user_event (
  id         text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  event_id   text NOT NULL REFERENCES event (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS user_event_user_id_idx ON user_event (user_id);
CREATE INDEX IF NOT EXISTS user_event_event_id_idx ON user_event (event_id);

CREATE TABLE IF NOT EXISTS notification (
  id       text PRIMARY KEY,
  user_id  text NOT NULL REFERENCES person (id) ON DELETE CASCADE,
  event_id text REFERENCES event (id) ON DELETE SET NULL,
  message  text NOT NULL,
  is_read  boolean NOT NULL DEFAULT false,
  sent_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notification_user_read_idx ON notification (user_id, is_read);
CREATE INDEX IF NOT EXISTS notification_event_id_idx ON notification (event_id);
CREATE INDEX IF NOT EXISTS notification_sent_at_idx ON notification (sent_at);

