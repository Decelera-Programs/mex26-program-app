// Ownership checks for audio storage paths. The browser uploads straight to the private
// bucket and then tells the backend the path; the backend later downloads/transcribes/signs
// it with the service role, so a client-supplied path must be proven to be the caller's own
// (same layout the frontend writes, with the Supabase auth uid as the owner folder).

// Same limit OpenAI enforces on a transcription upload.
export const MAX_TRANSCRIBABLE_AUDIO_BYTES = 25 * 1024 * 1024;

const SEGMENT = /^[A-Za-z0-9_-]+$/;
const FILE = /^\d{10,16}\.(webm|m4a|mp4|ogg|wav|mp3)$/;

function matches(path: string, segments: string[]) {
  const parts = path.split("/");
  if (parts.length !== segments.length + 1) return false;
  if (!segments.every((s, i) => parts[i] === s)) return false;
  return SEGMENT.test(parts[parts.length - 2] ?? "") && FILE.test(parts[parts.length - 1] ?? "");
}

export function isOwnedOneOnOnePath(path: string, oneOnOneId: string, authUid: string) {
  if (!SEGMENT.test(oneOnOneId) || !SEGMENT.test(authUid)) return false;
  return matches(path, ["one-on-ones", oneOnOneId, authUid]);
}

export function isOwnedTeamNotePath(path: string, targetType: string, targetId: string, authUid: string) {
  if (!["startup", "founder"].includes(targetType)) return false;
  if (!SEGMENT.test(targetId) || !SEGMENT.test(authUid)) return false;
  return matches(path, ["team-notes", targetType, targetId, authUid]);
}
