CREATE TABLE IF NOT EXISTS "OneOnOne" (
  "id" TEXT NOT NULL,
  "startup_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "start_time" TIMESTAMP(3) NOT NULL,
  "end_time" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "notes" TEXT,
  "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedat" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OneOnOne_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OneOnOne_startup_id_start_time_idx" ON "OneOnOne"("startup_id", "start_time");
CREATE INDEX IF NOT EXISTS "OneOnOne_person_id_start_time_idx" ON "OneOnOne"("person_id", "start_time");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OneOnOne_startup_id_fkey'
      AND table_name = 'OneOnOne'
  ) THEN
    ALTER TABLE "OneOnOne"
      ADD CONSTRAINT "OneOnOne_startup_id_fkey"
      FOREIGN KEY ("startup_id")
      REFERENCES "Startup"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'OneOnOne_person_id_fkey'
      AND table_name = 'OneOnOne'
  ) THEN
    ALTER TABLE "OneOnOne"
      ADD CONSTRAINT "OneOnOne_person_id_fkey"
      FOREIGN KEY ("person_id")
      REFERENCES "Person"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
