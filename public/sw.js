/* Simple service worker for offline support.
   This is intentionally minimal and backend-free. */

const CACHE_NAME = "decelera-mx-pwa-v6";

// Core shell files. Vite will fingerprint JS/CSS, so we cache navigation + static assets.
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.ico"];

// Venue wifi with ~200 people can hang a request for a long time. Opening the
// app waits at most this long for the network before using the cached shell
// (the network response still refreshes the cache for next time).
const NAVIGATION_TIMEOUT_MS = 2500;
// Fingerprinted assets from old deploys pile up; drop the ones not used for this long.
const ASSET_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k))));
      await self.clients.claim();
      await pruneOldAssets();
    })(),
  );
});

async function pruneOldAssets() {
  const cache = await caches.open(CACHE_NAME);
  const now = Date.now();
  for (const req of await cache.keys()) {
    if (!new URL(req.url).pathname.startsWith("/assets/")) continue;
    const res = await cache.match(req);
    const cachedAt = Number(res?.headers.get("x-sw-cached-at")) || 0;
    if (now - cachedAt > ASSET_MAX_AGE_MS) await cache.delete(req);
  }
}

// The worker itself rarely changes (so `activate` rarely runs): also prune
// after a fresh shell is fetched, at most once an hour.
let lastPruneAt = 0;
function maybePrune() {
  if (Date.now() - lastPruneAt < 60 * 60 * 1000) return undefined;
  lastPruneAt = Date.now();
  return pruneOldAssets().catch(() => {});
}

// Store a copy stamped with when it was cached (used by pruneOldAssets).
async function putStamped(cache, req, res) {
  const headers = new Headers(res.headers);
  headers.set("x-sw-cached-at", String(Date.now()));
  const body = await res.blob();
  await cache.put(req, new Response(body, { status: res.status, statusText: res.statusText, headers }));
}

// Navigations: network with a timeout, falling back to the cached shell.
// Assets: cache-first (they're fingerprinted, so a cached copy is never stale).
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs (the API and Supabase are other origins).
  if (url.origin !== self.location.origin || req.method !== "GET") return;

  // SPA navigation: every route serves the same index.html shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const network = fetch(req).then((fresh) => {
          if (fresh.ok) {
            const copy = fresh.clone();
            event.waitUntil(cache.put("/", copy).then(maybePrune));
          }
          return fresh;
        });
        // Keep the network request alive after a timeout so it still refreshes the shell.
        event.waitUntil(network.catch(() => {}));
        const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAVIGATION_TIMEOUT_MS));
        try {
          const first = await Promise.race([network, timeout]);
          if (first) return first;
        } catch {
          // Offline / network error: fall through to the cached shell.
        }
        const cached = await cache.match("/");
        if (cached) return cached;
        // No shell cached yet (first ever visit): nothing to fall back to, wait for the network.
        return network.catch(() => Response.error());
      })(),
    );
    return;
  }

  // Static assets: cache-first, then network.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      // The static server answers unknown paths (e.g. a chunk from an old
      // deploy) with index.html and a 200. Never cache that as the asset, or
      // the device would keep getting HTML for that JS file.
      const isHtml = (fresh.headers.get("content-type") || "").includes("text/html");
      if (fresh.ok && !isHtml) event.waitUntil(putStamped(cache, req, fresh.clone()));
      return fresh;
    })(),
  );
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json?.() || {};
  const title = payload.title || "Decelera México";
  const body = payload.body || "You have a new notification";
  const eventId = payload.eventId || null;
  const personId = payload.personId || null;
  const matchId = payload.matchId || null;
  const notificationId = payload.notificationId || null;
  let targetUrl;
  if (matchId) {
    // Match notifications land on Home (mounted at /home), which scrolls to and
    // opens the match card. Must be /home, not / — the "/" route redirects and
    // drops the query string.
    targetUrl = `/home?match=${encodeURIComponent(matchId)}`;
    if (notificationId) targetUrl += `&notif=${encodeURIComponent(notificationId)}`;
  } else {
    const baseUrl = eventId ? `/event/${eventId}` : personId ? `/person/${personId}` : "/notifications";
    targetUrl = notificationId ? `${baseUrl}?notif=${notificationId}` : baseUrl;
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // No large `icon`: just the small header / status-bar glyph. Android
      // renders `badge` from the alpha channel only and tints it with the
      // installed app's manifest theme_color (hence cyan, not the near-white
      // page background — that made the glyph invisible).
      badge: "/notification-badge-96.png",
      data: { url: targetUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/notifications";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return undefined;
    }),
  );
});

