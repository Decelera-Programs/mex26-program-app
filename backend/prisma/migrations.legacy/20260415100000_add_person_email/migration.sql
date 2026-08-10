-- Add email linkage field for Supabase auth -> Person matching.
ALTER TABLE "Person" ADD COLUMN IF NOT EXISTS "email" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Person_email_key" ON "Person"("email");
CREATE INDEX IF NOT EXISTS "Person_email_idx" ON "Person"("email");
