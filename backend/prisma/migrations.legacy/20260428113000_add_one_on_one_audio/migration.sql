-- Add active-audio snapshot fields to one-on-ones
ALTER TABLE "OneOnOne"
ADD COLUMN "active_audio_url" TEXT,
ADD COLUMN "active_audio_storage_path" TEXT,
ADD COLUMN "active_audio_duration_sec" INTEGER,
ADD COLUMN "active_audio_uploaded_at" TIMESTAMP(3),
ADD COLUMN "active_audio_status" TEXT;

-- Keep all submission attempts in history
CREATE TABLE "OneOnOneAudioSubmission" (
  "id" TEXT NOT NULL,
  "one_on_one_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "storage_path" TEXT,
  "public_url" TEXT,
  "mime_type" TEXT,
  "file_size_bytes" INTEGER,
  "duration_sec" INTEGER,
  "status" TEXT NOT NULL,
  "error_message" TEXT,
  "createdat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedat" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OneOnOneAudioSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OneOnOneAudioSubmission_one_on_one_id_createdat_idx"
  ON "OneOnOneAudioSubmission"("one_on_one_id", "createdat" DESC);

CREATE INDEX "OneOnOneAudioSubmission_user_id_idx"
  ON "OneOnOneAudioSubmission"("user_id");

ALTER TABLE "OneOnOneAudioSubmission"
ADD CONSTRAINT "OneOnOneAudioSubmission_one_on_one_id_fkey"
FOREIGN KEY ("one_on_one_id") REFERENCES "OneOnOne"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OneOnOneAudioSubmission"
ADD CONSTRAINT "OneOnOneAudioSubmission_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
