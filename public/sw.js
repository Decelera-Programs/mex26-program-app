/* Simple service worker for offline support.
   This is intentionally minimal and backend-free. */

const CACHE_NAME = "decelera-mx-pwa-v2";

// Core shell files. Vite will fingerprint JS/CSS, so we cache navigation + static assets.
const CORE_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.ico"];

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
    })(),
  );
});

// Network-first for navigations (SPA routes), cache-first for same-origin assets.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // SPA navigation: try network, fall back to cached "/" shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match("/")) || Response.error();
        }
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
      // Cache successful GET responses.
      if (req.method === "GET" && fresh.ok) cache.put(req, fresh.clone());
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
    // Match notifications land on Home, which scrolls to / opens the match card.
    targetUrl = `/?match=${encodeURIComponent(matchId)}`;
    if (notificationId) targetUrl += `&notif=${encodeURIComponent(notificationId)}`;
  } else {
    const baseUrl = eventId ? `/event/${eventId}` : personId ? `/person/${personId}` : "/notifications";
    targetUrl = notificationId ? `${baseUrl}?notif=${notificationId}` : baseUrl;
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/android-chrome-192x192.png",
      badge: "/favicon-32x32.png",
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

