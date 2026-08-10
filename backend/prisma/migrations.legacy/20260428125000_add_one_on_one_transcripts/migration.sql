ALTER TABLE "OneOnOne"
ADD COLUMN IF NOT EXISTS "audio_transcript" TEXT,
ADD COLUMN IF NOT EXISTS "audio_transcript_updated_at" TIMESTAMP(3);

ALTER TABLE "OneOnOneAudioSubmission"
ADD COLUMN IF NOT EXISTS "transcript_text" TEXT,
ADD COLUMN IF NOT EXISTS "transcript_error" TEXT,
ADD COLUMN IF NOT EXISTS "transcribed_at" TIMESTAMP(3);
