// Pure decision logic for the team-note transcription job, kept apart from index.ts
// (which starts the server on import) so it can be unit-tested.

// How a transcription failure should be treated by the retry logic:
//  - permanent: retrying can never help (damaged file, no speech) -> mark the note "failed" now.
//  - infra: not the note's fault (bad key, rate limit, OpenAI 5xx, network, config) -> keep
//    retrying and never count it against the note. A config problem must never be able to
//    mass-fail every note.
//  - note: tied to this note (e.g. its file cannot be downloaded) -> retry, but only up to
//    MAX_NOTE_TRANSCRIPTION_ATTEMPTS.
export type TranscriptionErrorKind = "permanent" | "infra" | "note";

export const MAX_NOTE_TRANSCRIPTION_ATTEMPTS = 5;

// Containers MediaRecorder can produce: webm (Chrome/Firefox/new Safari), mp4/m4a (older
// Safari/iOS), ogg (Firefox). Wav/mp3 are accepted too. Anything else is a recording whose
// first chunk was lost, which OpenAI rejects as "corrupted or unsupported".
export function hasKnownAudioContainer(buffer: ArrayBuffer) {
  const b = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 12));
  const webm = b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  const mp4 = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
  const ogg = b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53;
  const wav = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const mp3 = (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
  return webm || mp4 || ogg || wav || mp3;
}

export function audioFileNameFor(prefix: string, mimeType: string) {
  const mime = (mimeType || "").toLowerCase();
  const ext = mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
  return `${prefix}.${ext}`;
}

const FILE_PROBLEM = /corrupt|unsupported|could not be decoded|invalid file|too short|audio file|format/i;

export function classifyOpenAiFailure(status: number, message: string): TranscriptionErrorKind {
  if (status === 413 || status === 415) return "permanent";
  // Only a 400 that is clearly about the audio itself is permanent; any other 400/404/etc.
  // (wrong model, bad parameter...) is a configuration problem, not the note's.
  if ((status === 400 || status === 422) && FILE_PROBLEM.test(message)) return "permanent";
  return "infra";
}

export function previousAttempts(transcriptError: string | null | undefined) {
  return Number(/^\[intento (\d+)\//.exec(transcriptError || "")?.[1] || 0);
}

// What to write back on the note after a failed attempt.
export function decideFailureOutcome(kind: TranscriptionErrorKind, message: string, transcriptError: string | null | undefined) {
  const attempts = kind === "note" ? previousAttempts(transcriptError) + 1 : previousAttempts(transcriptError);
  const giveUp = kind === "permanent" || attempts >= MAX_NOTE_TRANSCRIPTION_ATTEMPTS;
  return {
    status: giveUp ? ("failed" as const) : ("uploaded" as const),
    transcript_error: giveUp ? message : `[intento ${attempts}/${MAX_NOTE_TRANSCRIPTION_ATTEMPTS}] ${message}`,
  };
}
