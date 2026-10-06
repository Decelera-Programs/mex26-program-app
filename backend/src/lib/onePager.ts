// One pagers live in the private "One pagers" bucket. `Startup.one_pager_url` stores the
// object path (e.g. "mex26/v2/Xoul.pdf"), never a URL. Only experience makers, VCs and the
// team may get a (short-lived, signed) URL; founders must never see one.

export const ONE_PAGER_BUCKET = "One pagers";
export const ONE_PAGER_SIGNED_URL_TTL_SEC = 10 * 60;

type PersonLike = { contact_type?: string | null; is_team?: boolean | null } | null | undefined;

function normalizeContactType(raw: unknown) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "experiencemaker" ? "experience_maker" : normalized;
}

export function canSeeOnePager(person: PersonLike) {
  if (!person) return false;
  const type = normalizeContactType(person.contact_type);
  return type === "experience_maker" || type === "vc" || type === "team" || Boolean(person.is_team);
}

export type OnePagerResult =
  | { status: 200; body: { url: string } }
  | { status: 403 | 404 | 500; body: { error: string } };

export async function resolveOnePager(opts: {
  person: PersonLike;
  storedPath: string | null | undefined;
  sign: (path: string, expiresInSec: number) => Promise<string | null>;
}): Promise<OnePagerResult> {
  if (!canSeeOnePager(opts.person)) return { status: 403, body: { error: "Forbidden" } };
  const path = opts.storedPath?.trim();
  // Only bucket paths are signed; anything that looks like a URL is never handed out.
  if (!path || /^https?:\/\//i.test(path)) return { status: 404, body: { error: "No one pager" } };
  try {
    const url = await opts.sign(path, ONE_PAGER_SIGNED_URL_TTL_SEC);
    if (!url) return { status: 500, body: { error: "Could not sign one pager" } };
    return { status: 200, body: { url } };
  } catch {
    return { status: 500, body: { error: "Could not sign one pager" } };
  }
}
