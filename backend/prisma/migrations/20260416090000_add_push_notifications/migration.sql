ALTER TABLE "Notification"
ADD COLUMN IF NOT EXISTS "pushed_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "user_agent" TEXT,
  "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedat" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_user_id_idx" ON "PushSubscription"("user_id");
CREATE INDEX IF NOT EXISTS "Notification_user_id_sent_at_idx" ON "Notification"("user_id", "sent_at");
CREATE INDEX IF NOT EXISTS "Notification_pushed_at_idx" ON "Notification"("pushed_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'PushSubscription_user_id_fkey'
      AND table_name = 'PushSubscription'
  ) THEN
    ALTER TABLE "PushSubscription"
      ADD CONSTRAINT "PushSubscription_user_id_fkey"
      FOREIGN KEY ("user_id")
      REFERENCES "Person"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
