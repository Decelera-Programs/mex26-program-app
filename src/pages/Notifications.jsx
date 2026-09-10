import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, BellOff, BellRing, Check, ShieldAlert } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  getCurrentUser,
  getPushPublicKey,
  listNotificationsForUser,
  markAllNotificationsReadForUser,
  markNotificationRead,
  subscribePush,
} from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";
import { formatRelativeTime } from "../lib/dateTime";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function Notifications() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  // null = detecting, 'active' | 'inactive' | 'blocked' | 'unsupported'
  const [pushStatus, setPushStatus] = useState(null);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchNotifications(showLoader = false) {
      if (showLoader) setLoading(true);
      try {
        setRefreshError("");
        const me = await getCurrentUser();
        if (cancelled) return;
        setUser(me);
        if (!me?.email) {
          setNotifications([]);
          setLoading(false);
          return;
        }
        const notifs = await listNotificationsForUser(me.email);
        if (cancelled) return;
        setNotifications(notifs);
        setLastSyncedAt(new Date());
      } catch (error) {
        if (!cancelled) {
          setRefreshError(error instanceof Error ? error.message : "Could not refresh notifications.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNotifications(true);

    const interval = setInterval(() => {
      fetchNotifications(false).catch(() => {});
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications],
  );

  useEffect(() => {
    async function detectPushStatus() {
      if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setPushStatus("blocked");
        return;
      }
      if (Notification.permission === "granted") {
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => setTimeout(reject, 3000)),
          ]);
          const sub = await reg.pushManager.getSubscription();
          setPushStatus(sub ? "active" : "inactive");
        } catch {
          setPushStatus("inactive");
        }
        return;
      }
      setPushStatus("inactive");
    }
    detectPushStatus();
  }, []);

  async function enablePush() {
    setPushLoading(true);
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") {
        setPushStatus("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) { setPushStatus("active"); return; }
      const vapidKey = await getPushPublicKey();
      if (!vapidKey) return;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await subscribePush(sub.toJSON());
      setPushStatus("active");
    } catch {
      // silent
    } finally {
      setPushLoading(false);
    }
  }

  if (!loading && !user) return <UserNotRegisteredError />;

  async function onMarkAsRead(notif) {
    await markNotificationRead(notif.id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === notif.id ? { ...n, is_read: true } : n)),
    );
  }

  async function onMarkAllRead() {
    if (!user?.email) return;
    await markAllNotificationsReadForUser(user.email);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  function openEventModal(eventId) {
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.set("event", eventId);
    navigate(`${location.pathname}?${nextSearch.toString()}`);
  }

  if (loading) return <LoadingState message="Preparing your day" />;

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 22,
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
            marginBottom: 18,
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4">
            <div>
              <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
                Notifications
              </h1>
              <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>
                {unreadCount > 0 ? `${unreadCount} unread` : "All caught up!"}
              </p>
              {lastSyncedAt && (
                <p style={{ fontSize: 10, color: "#6E7892", opacity: 0.7, marginTop: 2 }}>
                  Synced {formatRelativeTime(lastSyncedAt)}
                </p>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={onMarkAllRead}
                className="app-card-interactive"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  borderRadius: 20,
                  padding: "10px 14px",
                  backgroundColor: "#2D3852",
                  color: "#FFFFFF",
                  fontSize: 11,
                  fontWeight: 800,
                  fontFamily: "Fustat, sans-serif",
                  letterSpacing: "0.02em",
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <Check size={12} />
                Mark all read
              </button>
            )}
          </Motion.div>

          {/* Push notification status row */}
          {pushStatus && pushStatus !== "unsupported" && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(45,56,82,0.10)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              {pushStatus === "active" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <BellRing size={12} color="#2D3852" strokeWidth={2} />
                    <span style={{ fontSize: 11, color: "#2D3852", fontWeight: 600, fontFamily: "Fustat, sans-serif" }}>Push notifications on</span>
                  </div>
                  <span style={{ width: 7, height: 7, borderRadius: 9999, backgroundColor: "#1FD0EF", flexShrink: 0, display: "inline-block" }} />
                </>
              )}
              {pushStatus === "inactive" && (
                <>
                  <span style={{ fontSize: 11, color: "#6E7892", fontFamily: "Fustat, sans-serif" }}>Get reminders before your sessions</span>
                  <button
                    onClick={enablePush}
                    disabled={pushLoading}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 20, padding: "7px 12px", backgroundColor: "#2D3852", color: "#FFFFFF", fontSize: 10, fontWeight: 800, fontFamily: "Fustat, sans-serif", letterSpacing: "0.02em", border: "none", cursor: pushLoading ? "default" : "pointer", opacity: pushLoading ? 0.65 : 1, whiteSpace: "nowrap", flexShrink: 0 }}
                  >
                    <Bell size={10} />
                    {pushLoading ? "Enabling…" : "Enable"}
                  </button>
                </>
              )}
              {pushStatus === "blocked" && (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <ShieldAlert size={12} color="#6E7892" strokeWidth={1.8} />
                  <span style={{ fontSize: 11, color: "#6E7892", fontFamily: "Fustat, sans-serif" }}>Blocked — enable in your browser settings</span>
                </div>
              )}
            </div>
          )}
        </div>

        {refreshError && (
          <div
            className="rounded-[20px] border px-[18px] py-3 mb-3"
            style={{ background: "#FFFFFF", borderColor: "#FFD0D0" }}
          >
            <p style={{ fontSize: 11, color: "#D9534F" }}>{refreshError}</p>
          </div>
        )}

        {notifications.length === 0 ? (
          <div
            className="rounded-[20px] border text-center"
            style={{ background: "#FFFFFF", borderColor: "#EEF2F5", padding: "40px 18px" }}
          >
            <BellOff className="h-8 w-8 mx-auto mb-3" style={{ color: "#B9C1D4" }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852" }}>No notifications yet</p>
            <p style={{ fontSize: 11, color: "#6E7892", marginTop: 4 }}>
              You&apos;ll receive reminders before your events
            </p>
          </div>
        ) : (
          <div className="card-list">
            <AnimatePresence>
              {notifications.map((notif, i) => (
                <Motion.div
                  key={notif.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  style={{ opacity: notif.is_read ? 0.6 : 1 }}
                >
                  <button
                    type="button"
                    onClick={async () => {
                      await onMarkAsRead(notif);
                      if (notif.event_id) openEventModal(notif.event_id);
                      else if (notif.match_id) navigate(`/home?match=${notif.match_id}`);
                      else if (notif.counterpart_person_id) navigate(`/person/${notif.counterpart_person_id}`);
                    }}
                    className="notification-card w-full text-left rounded-[20px] border transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
                    style={{ background: "#FFFFFF", borderColor: notif.is_read ? "#EEF2F5" : "#D6EEF5" }}
                  >
                    <div className="flex items-start gap-[14px]">
                      <div
                        className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: notif.is_read ? "#F2F8FA" : "#1FD0EF" }}
                      >
                        <Bell size={15} color={notif.is_read ? "#6E7892" : "#2D3852"} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p style={{ fontSize: 14, fontWeight: 600, color: notif.is_read ? "#6E7892" : "#2D3852", lineHeight: 1.3 }} className="leading-tight">
                            {notif.title}
                          </p>
                          {!notif.is_read && (
                            <span
                              aria-hidden="true"
                              style={{ width: 7, height: 7, borderRadius: 9999, backgroundColor: "#1FD0EF", flexShrink: 0 }}
                            />
                          )}
                        </div>
                        <p style={{ fontSize: 11, color: "#6E7892", marginTop: 3 }} className="line-clamp-2">
                          {notif.message}
                        </p>
                        <p style={{ fontSize: 10, color: "#6E7892", opacity: 0.7, marginTop: 6 }}>
                          {formatRelativeTime(notif.created_date)}
                        </p>
                      </div>
                    </div>
                  </button>
                </Motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}

      </div>
    </div>
  );
}
