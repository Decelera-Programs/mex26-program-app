import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// A chunk failed to load (usually a page opened on an old deploy): reload to
// get the current one. At most once every 30 s, so a flaky connection that
// keeps serving the cached shell can't turn this into a reload loop.
window.addEventListener("vite:preloadError", () => {
  const KEY = "decelera.preloadErrorReloadAt";
  try {
    const last = Number(sessionStorage.getItem(KEY)) || 0;
    if (Date.now() - last < 30000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable: still reload once */
  }
  window.location.reload();
});

if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // ignore: SW registration is optional
      });
    });
  } else {
    // Prevent stale caches while developing.
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
