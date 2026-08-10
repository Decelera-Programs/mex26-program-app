-- Link Person to Supabase auth.users id.
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "user_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Person_user_id_fkey'
  ) THEN
    ALTER TABLE "Person"
      ADD CONSTRAINT "Person_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES auth.users(id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Person_user_id_key" ON "Person"("user_id");
CREATE INDEX IF NOT EXISTS "Person_user_id_idx" ON "Person"("user_id");
