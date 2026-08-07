import { supabase } from "../lib/supabaseClient";
import { API_BASE_URL } from "../lib/apiBaseUrl";
const CACHE_TTL_MS = 60 * 1000;
const ONE_ON_ONE_AUDIO_BUCKET = import.meta.env.VITE_SUPABASE_AUDIO_BUCKET || "one-on-ones-audio";

let peopleCache = { value: null, expiresAt: 0, promise: null };
let eventsCache = { value: null, expiresAt: 0, promise: null };
let startupsCache = { value: null, expiresAt: 0, promise: null };
let currentUserCache = { value: undefined, expiresAt: 0, promise: null };
let accessTokenCache = { value: "", expiresAt: 0, promise: null };
const userIdByIdentifierCache = new Map();

if (supabase) {
  supabase.auth.onAuthStateChange(() => {
    currentUserCache = { value: undefined, expiresAt: 0, promise: null };
    accessTokenCache = { value: "", expiresAt: 0, promise: null };
    peopleCache = { value: null, expiresAt: 0, promise: null };
    eventsCache = { value: null, expiresAt: 0, promise: null };
    startupsCache = { value: null, expiresAt: 0, promise: null };
    userIdByIdentifierCache.clear();
  });
}

function getJwtExpiryMs(token) {
  if (!token || typeof token !== "string") return 0;
  const parts = token.split(".");
  if (parts.length < 2) return 0;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp !== "number") return 0;
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}

async function getAccessToken() {
  if (!supabase) return "";
  if (Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.value;
  }
  if (accessTokenCache.promise) return accessTokenCache.promise;

  accessTokenCache.promise = (async () => {
    // Right after login, session propagation can lag briefly.
    for (let i = 0; i < 8; i += 1) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || "";
      if (token) {
        const tokenExpiryMs = getJwtExpiryMs(token);
        // Reuse token until shortly before expiry to avoid repeated getSession calls.
        const fallbackTtlMs = 30 * 1000;
        accessTokenCache.value = token;
        accessTokenCache.expiresAt = tokenExpiryMs
          ? Math.max(Date.now() + 1000, tokenExpiryMs - 30 * 1000)
          : Date.now() + fallbackTtlMs;
        return token;
      }
      if (i < 7) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    // Briefly cache empty value to avoid thundering-herd retries.
    accessTokenCache.value = "";
    accessTokenCache.expiresAt = Date.now() + 1000;
    return "";
  })();

  try {
    return await accessTokenCache.promise;
  } finally {
    accessTokenCache.promise = null;
  }
}

async function api(path, init) {
  if (!API_BASE_URL) {
    throw new Error(
      "VITE_API_BASE_URL is not configured. Set it to your backend URL (e.g. https://<backend>.up.railway.app).",
    );
  }
  const token = await getAccessToken();
  const initHeaders = init?.headers || {};
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...initHeaders,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `API ${response.status} on ${path} (${API_BASE_URL}${path}): ${text || "Unknown error"}`,
    );
  }

  if (response.status === 204) return null;
  return response.json();
}

function parseExpertiseTags(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhotoUrl(raw) {
  if (typeof raw !== "string") return "";
  const url = raw.trim();
  if (!url) return "";

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("drive.google.com")) return url;

    const toDriveImageUrl = (fileId) =>
      // googleusercontent tends to be more reliable for <img> rendering than drive page URLs.
      `https://lh3.googleusercontent.com/d/${fileId}=w1200`;

    const toDriveThumbnail = (fileId) => `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`;
    const fromId = (fileId) => toDriveImageUrl(fileId) || toDriveThumbnail(fileId);

    // https://drive.google.com/file/d/<FILE_ID>/view?usp=sharing
    const fileMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/);
    if (fileMatch?.[1]) {
      return fromId(fileMatch[1]);
    }

    // https://drive.google.com/open?id=<FILE_ID>
    const id = parsed.searchParams.get("id");
    if (id) {
      return fromId(id);
    }

    // https://drive.google.com/uc?export=view|download&id=<FILE_ID>
    if (parsed.pathname === "/uc") {
      const ucId = parsed.searchParams.get("id");
      if (ucId) return fromId(ucId);
    }
  } catch {
    // If it's not a valid URL, keep original to avoid data loss.
  }

  return url;
}

function normalizeContactType(raw) {
  if (typeof raw !== "string") return "";
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "experience_maker" || normalized === "experiencemaker") return "experience_maker";
  if (normalized === "founder") return "founder";
  if (normalized === "vc") return "vc";
  if (normalized === "team") return "team";
  if (normalized === "alumni") return "alumni";
  return normalized;
}

function normalizePerson(person) {
  if (!person) return null;
  const contactType = normalizeContactType(
    person.contact_type ?? person.contactType ?? person.person_type ?? "",
  );
  return {
    ...person,
    // Keep existing page contracts while backend remains lean.
    company: person.company ?? person.company_name ?? "",
    title: person.title ?? "",
    contact_type: contactType,
    // Backward-compatible alias while components migrate.
    person_type: contactType,
    photo_url: normalizePhotoUrl(person.photo_url),
    email: person.email ?? person.id,
    expertise_tags: parseExpertiseTags(person.expertise_tags),
  };
}

function normalizeEvent(event) {
  if (!event) return null;
  return { ...event };
}

function normalizeNotification(notification) {
  if (!notification) return null;
  return {
    ...notification,
    title: notification.title || "Program update",
    created_date: notification.created_date || notification.sent_at,
    type: notification.type || "general",
  };
}

function normalizeOneOnOne(record) {
  if (!record) return null;
  return {
    ...record,
    startup_name: record.startup?.name || "",
    startup_logo_url: normalizePhotoUrl(record.startup?.logo_url),
    em_name: record.em?.full_name || "",
    em_photo_url: normalizePhotoUrl(record.em?.photo_url),
  };
}

function normalizeStartup(startup) {
  if (!startup) return null;
  return {
    ...startup,
    logo_url: normalizePhotoUrl(startup.logo_url),
  };
}

async function resolveUserId(userIdentifier) {
  if (!userIdentifier) return "";
  const cached = userIdByIdentifierCache.get(userIdentifier);
  if (cached !== undefined) return cached;

  const me = await getCurrentUser();
  const resolved = me?.id || "";
  userIdByIdentifierCache.set(userIdentifier, resolved);
  return resolved;
}

export async function getCurrentUser() {
  if (Date.now() < currentUserCache.expiresAt && currentUserCache.value !== undefined) {
    return currentUserCache.value;
  }
  if (currentUserCache.promise) return currentUserCache.promise;

  currentUserCache.promise = (async () => {
    // Identity must come from backend /me (Supabase token verified server-side).
    for (let i = 0; i < 4; i += 1) {
      try {
        const person = await api("/me");
        const normalized = normalizePerson(person);
        const resolved = normalized ? { ...normalized, email: normalized.email || normalized.id } : null;
        currentUserCache.value = resolved;
        currentUserCache.expiresAt = Date.now() + CACHE_TTL_MS;
        return resolved;
      } catch {
        if (i < 3) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }

    currentUserCache.value = null;
    currentUserCache.expiresAt = Date.now() + 2000;
    return null;
  })();

  try {
    return await currentUserCache.promise;
  } finally {
    currentUserCache.promise = null;
  }
}

export async function listEvents() {
  if (Date.now() < eventsCache.expiresAt && eventsCache.value) return eventsCache.value;
  if (eventsCache.promise) return eventsCache.promise;

  eventsCache.promise = api("/events").then((events) => {
    const normalized = events.map(normalizeEvent);
    eventsCache.value = normalized;
    eventsCache.expiresAt = Date.now() + CACHE_TTL_MS;
    return normalized;
  }).finally(() => {
    eventsCache.promise = null;
  });

  return eventsCache.promise;
}

export async function getHomeDailyContent(dateKey) {
  const query = dateKey ? `?date=${encodeURIComponent(dateKey)}` : "";
  return api(`/home-content${query}`);
}

export async function getEventById(id) {
  const events = await listEvents();
  return events.find((event) => event.id === id) || null;
}

export async function listEventPeople(eventId) {
  if (!eventId) return [];
  const people = await api(`/events/${encodeURIComponent(eventId)}/people`);
  return Array.isArray(people) ? people.map(normalizePerson).filter((p) => p && p.contact_type) : [];
}

export async function getMyScheduleDayFeedback(dayKey) {
  if (!dayKey) return {};
  const payload = await api(`/feedback/schedule/${encodeURIComponent(dayKey)}`);
  const ratings = payload?.ratings;
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return {};
  return ratings;
}

export async function getMyDailyCheckin(dayKey) {
  if (!dayKey) return null;
  return api(`/check-in/daily/${encodeURIComponent(dayKey)}`);
}

export async function submitMyDailyCheckin(dayKey, payload) {
  if (!dayKey) return null;
  return api(`/check-in/daily/${encodeURIComponent(dayKey)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function setMyScheduleEventFeedback(dayKey, eventId, rating) {
  if (!dayKey || !eventId) return {};
  const payload = await api(`/feedback/schedule/${encodeURIComponent(dayKey)}`, {
    method: "PUT",
    body: JSON.stringify({
      event_id: eventId,
      rating,
    }),
  });
  const ratings = payload?.schedule_feedback;
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return {};
  return ratings;
}

export async function listPeople() {
  if (Date.now() < peopleCache.expiresAt && peopleCache.value) return peopleCache.value;
  if (peopleCache.promise) return peopleCache.promise;

  peopleCache.promise = api("/people").then((people) => {
    const normalized = people.map(normalizePerson).filter((p) => p && p.contact_type);
    peopleCache.value = normalized;
    peopleCache.expiresAt = Date.now() + CACHE_TTL_MS;
    return normalized;
  }).finally(() => {
    peopleCache.promise = null;
  });

  return peopleCache.promise;
}

export async function getPersonById(id) {
  const people = await listPeople();
  return people.find((person) => person.id === id) || null;
}

export async function listStartups() {
  if (Date.now() < startupsCache.expiresAt && startupsCache.value) return startupsCache.value;
  if (startupsCache.promise) return startupsCache.promise;

  startupsCache.promise = api("/startups").then((startups) => {
    const normalized = Array.isArray(startups) ? startups.map(normalizeStartup) : [];
    startupsCache.value = normalized;
    startupsCache.expiresAt = Date.now() + CACHE_TTL_MS;
    return normalized;
  }).finally(() => {
    startupsCache.promise = null;
  });

  return startupsCache.promise;
}

export async function getStartupById(id) {
  const startups = await listStartups();
  return startups.find((startup) => startup.id === id) || null;
}

export async function listUserScheduleEvents(userEmail) {
  const me = await getCurrentUser();
  const userIdentifier = me?.id || userEmail;
  if (!userIdentifier) return [];
  const userId = await resolveUserId(userIdentifier);
  if (!userId) return [];
  const events = await api(`/users/${encodeURIComponent(userId)}/schedule`);
  return events.map(normalizeEvent);
}

export async function listNotificationsForUser(userEmail) {
  const me = await getCurrentUser();
  const userIdentifier = me?.id || userEmail;
  if (!userIdentifier) return [];
  const userId = await resolveUserId(userIdentifier);
  if (!userId) return [];
  const notifications = await api(`/users/${encodeURIComponent(userId)}/notifications`);
  return notifications.map(normalizeNotification);
}

export async function markNotificationRead(notificationId) {
  await api(`/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH",
  });
}

export async function markAllNotificationsReadForUser(userEmail) {
  const me = await getCurrentUser();
  const userIdentifier = me?.id || userEmail;
  if (!userIdentifier) return;
  const userId = await resolveUserId(userIdentifier);
  if (!userId) return;
  await api(`/users/${encodeURIComponent(userId)}/notifications/read-all`, {
    method: "PATCH",
  });
}

export async function getPushPublicKey() {
  const payload = await api("/push/public-key");
  return payload?.publicKey || "";
}

export async function subscribePush(subscription) {
  return api("/push/subscribe", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(endpoint) {
  return api("/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

export async function previewCampaignAudience(filters, adminKey = "") {
  return api("/campaigns/preview", {
    method: "POST",
    headers: adminKey ? { "x-admin-key": adminKey } : undefined,
    body: JSON.stringify({ filters }),
  });
}

export async function listCampaigns(adminKey = "") {
  return api("/campaigns", {
    headers: adminKey ? { "x-admin-key": adminKey } : undefined,
  });
}

export async function createCampaign(payload, adminKey = "") {
  return api("/campaigns", {
    method: "POST",
    headers: adminKey ? { "x-admin-key": adminKey } : undefined,
    body: JSON.stringify(payload),
  });
}

export async function sendCampaignNow(campaignId, adminKey = "") {
  return api(`/campaigns/${encodeURIComponent(campaignId)}/send-now`, {
    method: "POST",
    headers: adminKey ? { "x-admin-key": adminKey } : undefined,
  });
}

async function listMyOneOnOnes() {
  const records = await api("/one-on-ones/me");
  return Array.isArray(records) ? records.map(normalizeOneOnOne) : [];
}

export async function uploadOneOnOneAudioToStorage(oneOnOneId, file) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!oneOnOneId || !file) throw new Error("Missing audio upload parameters.");
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData?.user?.id || "";
  if (!authUserId) throw new Error("No authenticated Supabase user found.");

  const extensionFromType = (file.type || "").includes("mp4") ? "m4a" : "webm";
  const MAX_ATTEMPTS = 3;
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    // New path per attempt so a partial upload never blocks a retry
    const storagePath = `one-on-ones/${oneOnOneId}/${authUserId}/${Date.now()}.${extensionFromType}`;
    const { error: uploadError } = await supabase.storage
      .from(ONE_ON_ONE_AUDIO_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "audio/webm",
      });
    if (!uploadError) {
      const { data } = supabase.storage.from(ONE_ON_ONE_AUDIO_BUCKET).getPublicUrl(storagePath);
      return { storagePath, publicUrl: data?.publicUrl || "" };
    }
    lastError = uploadError;
  }
  throw new Error(lastError?.message || "Could not upload audio.");
}

export async function registerOneOnOneAudioSubmission(oneOnOneId, payload) {
  if (!oneOnOneId) throw new Error("Missing one-on-one id.");
  return api(`/one-on-ones/${encodeURIComponent(oneOnOneId)}/audio`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getOneOnOneAudio(oneOnOneId) {
  if (!oneOnOneId) return { active_audio: null, submissions: [] };
  const data = await api(`/one-on-ones/${encodeURIComponent(oneOnOneId)}/audio`);
  return {
    one_on_one_id: data?.one_on_one_id || oneOnOneId,
    active_audio: data?.active_audio || null,
    submissions: Array.isArray(data?.submissions) ? data.submissions : [],
  };
}

export async function listMyOneOnOneAudio() {
  const data = await api("/one-on-ones/me/audio");
  if (!Array.isArray(data)) return {};
  return Object.fromEntries(
    data.map((item) => [
      item.one_on_one_id,
      {
        one_on_one_id: item.one_on_one_id,
        active_audio: item.active_audio || null,
        transcript: item.transcript || "",
        transcript_updated_at: item.transcript_updated_at || null,
        submissions: Array.isArray(item.submissions) ? item.submissions : [],
      },
    ]),
  );
}

export async function uploadTeamAudioToStorage(targetType, targetId, file) {
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!targetType || !targetId || !file) throw new Error("Missing audio upload parameters.");
  const { data: authData } = await supabase.auth.getUser();
  const authUserId = authData?.user?.id || "";
  if (!authUserId) throw new Error("No authenticated Supabase user found.");

  const extensionFromType = (file.type || "").includes("mp4") ? "m4a" : "webm";
  const safeName = `${Date.now()}.${extensionFromType}`;
  const storagePath = `team-notes/${targetType}/${targetId}/${authUserId}/${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(ONE_ON_ONE_AUDIO_BUCKET)
    .upload(storagePath, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "audio/webm",
    });
  if (uploadError) throw new Error(uploadError.message || "Could not upload audio.");

  const { data } = supabase.storage.from(ONE_ON_ONE_AUDIO_BUCKET).getPublicUrl(storagePath);
  return { storagePath, publicUrl: data?.publicUrl || "" };
}

export async function submitTeamAudioNote(payload) {
  return api("/team-notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listMyTeamNotes() {
  const data = await api("/team-notes/me");
  if (!Array.isArray(data)) return [];
  return data.map((note) => ({
    ...note,
    startup: note.startup ? normalizeStartup(note.startup) : null,
    founder: note.founder ? normalizePerson(note.founder) : null,
  }));
}

export { listMyOneOnOnes };
