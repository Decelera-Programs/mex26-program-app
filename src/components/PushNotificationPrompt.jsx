import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { getPushPublicKey, subscribePush } from "../api/dataService";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function doSubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) return existing;
  const vapidKey = await getPushPublicKey();
  if (!vapidKey) return null;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });
  await subscribePush(sub.toJSON());
  return sub;
}

export default function PushNotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) return;

    if (Notification.permission === "denied") return;

    if (Notification.permission === "default") {
      setVisible(true);
      return;
    }

    // permission === "granted" — check if active subscription exists
    async function checkSubscription() {
      try {
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(), 4000)),
        ]);
        const existing = await reg.pushManager.getSubscription();
        if (!existing) await doSubscribe();
      } catch {
        // SW not available or timed out — silent
      }
    }
    checkSubscription();
  }, []);

  async function onEnable() {
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") await doSubscribe();
    } catch {
      // silent
    } finally {
      setLoading(false);
      setVisible(false);
    }
  }

  function onDismiss() {
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <div
          style={{
            position: "fixed",
            bottom: "calc(88px + env(safe-area-inset-bottom, 0px))",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9000,
            width: "calc(100% - 20px)",
            maxWidth: 370,
          }}
        >
        <Motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
        >
          <div
            style={{
              background: "#FAF3DC",
              borderRadius: 16,
              padding: "11px 12px 11px 14px",
              boxShadow: "0 8px 32px rgba(45,56,82,0.18)",
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 9999,
                background: "#2D3852",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Bell size={12} color="#FFFFFF" strokeWidth={1.8} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#2D3852", margin: 0, lineHeight: 1.3 }}>
                Stay in the loop
              </p>
              <p style={{ fontSize: 10, color: "#6E7892", marginTop: 2, lineHeight: 1.4 }}>
                Enable notifications to get reminders before your sessions.
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button
                  onClick={onEnable}
                  disabled={loading}
                  style={{
                    background: "#2D3852",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: 20,
                    padding: "6px 14px",
                    fontSize: 10,
                    fontWeight: 800,
                    fontFamily: "Fustat, sans-serif",
                    letterSpacing: "0.02em",
                    cursor: loading ? "default" : "pointer",
                    opacity: loading ? 0.65 : 1,
                  }}
                >
                  {loading ? "Enabling…" : "Enable"}
                </button>
                <button
                  onClick={onDismiss}
                  style={{
                    background: "transparent",
                    color: "#6E7892",
                    border: "none",
                    borderRadius: 20,
                    padding: "6px 8px",
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Not now
                </button>
              </div>
            </div>

            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              style={{
                background: "transparent",
                border: "none",
                padding: 3,
                cursor: "pointer",
                color: "#6E7892",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={12} />
            </button>
          </div>
        </Motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
