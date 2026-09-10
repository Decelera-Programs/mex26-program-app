import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { Home, Calendar, Info, Users, Building2, ArrowLeft, Bell, LogOut } from "lucide-react";
import { Suspense, useState, useEffect, useRef } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import LoadingState from "./LoadingState";
import EventDetailsModal from "./EventDetailsModal";
import PushNotificationPrompt from "./PushNotificationPrompt";
import { getCurrentUser, listNotificationsForUser, markNotificationRead, signOut, unsubscribePush } from "../api/dataService";
import { supabase } from "../lib/supabaseClient";
import { DUR, EASE } from "../lib/motion";

const navItems = [
  { path: "/home", icon: Home, label: "Home" },
  { path: "/schedule", icon: Calendar, label: "Schedule" },
  { path: "/info", icon: Info, label: "Info" },
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isHomeRoute = location.pathname === "/home";
  const [attendeesOpen, setAttendeesOpen] = useState(false);
  const attendeesRef = useRef(null);
  const isAttendeesActive = ["/people", "/startups"].includes(location.pathname);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => { setAttendeesOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!attendeesOpen) return;
    function handle(e) {
      if (attendeesRef.current && !attendeesRef.current.contains(e.target)) {
        setAttendeesOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [attendeesOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    function handle(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [profileOpen]);

  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let channel = null;

    async function init() {
      try {
        const me = await getCurrentUser();
        if (cancelled || !me?.email) return;
        setCurrentUser(me);

        const notifs = await listNotificationsForUser(me.email);
        if (!cancelled) setUnreadCount(notifs.filter((n) => !n.is_read).length);

        if (!supabase) return;
        const { data: { session } } = await supabase.auth.getSession();
        const authUserId = session?.user?.id;
        if (!authUserId || cancelled) return;

        channel = supabase
          .channel(`notifications-badge-${authUserId}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "Notification", filter: `user_id=eq.${authUserId}` },
            async () => {
              if (cancelled) return;
              try {
                const fresh = await listNotificationsForUser(me.email);
                if (!cancelled) setUnreadCount(fresh.filter((n) => !n.is_read).length);
              } catch { /* silent */ }
            }
          )
          .subscribe();
      } catch {
        // silent — badge is best-effort
      }
    }

    init();

    return () => {
      cancelled = true;
      if (channel) supabase?.removeChannel(channel);
    };
  }, []);

  const searchParams = new URLSearchParams(location.search);
  const eventModalId = searchParams.get("event");

  // Auto-mark notification read when arriving from a push click (?notif=id)
  useEffect(() => {
    const notifId = searchParams.get("notif");
    if (!notifId) return;
    markNotificationRead(notifId).catch(() => {});
    const next = new URLSearchParams(location.search);
    next.delete("notif");
    const nextQuery = next.toString();
    navigate(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, { replace: true });
  }, [location.search]);

  function closeEventModal() {
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.delete("event");
    const nextQuery = nextSearch.toString();
    navigate(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, { replace: true });
  }

  return (
    <div className="h-dvh w-full flex flex-col overflow-hidden overflow-x-hidden" style={{ background: "#F2F8FA" }}>
      
      {/* Contenedor central limitado al ancho de móvil */}
      <div className="w-full max-w-[440px] mx-auto h-full flex flex-col relative overflow-x-hidden">
        
        {/* Back button */}
        {!isHomeRoute && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            style={{
              position: "absolute",
              top: "calc(env(safe-area-inset-top, 0px) + 10px)",
              left: 14,
              zIndex: 100,
              background: "transparent",
              border: "none",
              padding: 6,
              cursor: "pointer",
              color: "#6E7892",
              display: "flex",
              alignItems: "center",
            }}
          >
            <ArrowLeft strokeWidth={1.8} style={{ width: 20, height: 20 }} />
          </button>
        )}

        {/* Bell button — top right, all pages except /notifications */}
        {location.pathname !== "/notifications" && (
          <Link
            to="/notifications"
            aria-label="Notifications"
            className="press-scale"
            style={{
              position: "absolute",
              top: "calc(env(safe-area-inset-top, 0px) + 10px)",
              right: 58,
              zIndex: 100,
              width: 34,
              height: 34,
              borderRadius: 9999,
              background: "rgba(255,255,255,0.85)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: "1px solid rgba(45,56,82,0.08)",
              boxShadow: "0 2px 8px rgba(45,56,82,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <Bell size={15} strokeWidth={1.8} color="#6E7892" />
            {unreadCount > 0 && (
              <span
                aria-label={`${unreadCount} unread`}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 8,
                  height: 8,
                  borderRadius: 9999,
                  backgroundColor: "#FFB950",
                  border: "1.5px solid #F2F8FA",
                }}
              />
            )}
          </Link>
        )}

        {/* Profile button — top right corner */}
        <div
          ref={profileRef}
          style={{
            position: "absolute",
            top: "calc(env(safe-area-inset-top, 0px) + 10px)",
            right: 14,
            zIndex: 101,
          }}
        >
          <button
            type="button"
            aria-label="Profile menu"
            onClick={() => setProfileOpen((v) => !v)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 9999,
              background: "rgba(255,255,255,0.85)",
              backdropFilter: "blur(10px)",
              WebkitBackdropFilter: "blur(10px)",
              border: "1px solid rgba(45,56,82,0.08)",
              boxShadow: "0 2px 8px rgba(45,56,82,0.10)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 0,
              overflow: "hidden",
            }}
          >
            {currentUser?.photo_url ? (
              <img
                src={currentUser.photo_url}
                alt={currentUser.full_name || "Profile"}
                style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 9999 }}
              />
            ) : (
              <span style={{ fontSize: 13, fontWeight: 700, color: "#6E7892", fontFamily: "Fustat, sans-serif" }}>
                {currentUser?.full_name?.[0]?.toUpperCase() || "?"}
              </span>
            )}
          </button>

          <AnimatePresence>
            {profileOpen && (
              <Motion.div
                initial={{ opacity: 0, scale: 0.88, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.88, y: -6 }}
                transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  transformOrigin: "top right",
                  background: "rgba(255,255,255,0.96)",
                  backdropFilter: "blur(18px) saturate(140%)",
                  WebkitBackdropFilter: "blur(18px) saturate(140%)",
                  borderRadius: 16,
                  padding: 6,
                  boxShadow: "0 8px 28px rgba(45,56,82,0.18), 0 1px 3px rgba(45,56,82,0.06)",
                  border: "1px solid rgba(255,255,255,0.7)",
                  minWidth: 140,
                }}
              >
                <button
                  type="button"
                  onClick={async () => {
                    setProfileOpen(false);
                    try {
                      const reg = await navigator.serviceWorker.getRegistration();
                      if (reg) {
                        const sub = await reg.pushManager.getSubscription();
                        if (sub) {
                          await unsubscribePush(sub.endpoint);
                          await sub.unsubscribe();
                        }
                      }
                    } catch { /* silent */ }
                    await signOut();
                    navigate("/login", { replace: true });
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    borderRadius: 10,
                    padding: "10px 12px",
                    cursor: "pointer",
                    color: "#2D3852",
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "Fustat, sans-serif",
                    textAlign: "left",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "#F2F8FA"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <LogOut size={14} strokeWidth={2} color="#6E7892" />
                  Log out
                </button>
              </Motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ÁREA DE CONTENIDO: con scroll independiente */}
        <main
          className="flex-1 w-full overflow-y-auto overflow-x-hidden pt-8"
          style={{
            scrollbarWidth: 'none', /* Esconde scroll en Firefox */
            paddingTop: isHomeRoute
              ? "env(safe-area-inset-top, 0px)"
              : "calc(env(safe-area-inset-top, 0px) + 2rem)",
            paddingBottom: isHomeRoute
              ? "calc(6.1rem + env(safe-area-inset-bottom, 0px))"
              : "calc(8.3rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          <Suspense fallback={<LoadingState />}>
            <Motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.page, ease: EASE.out }}
              className="w-full"
            >
              <Outlet />
            </Motion.div>
          </Suspense>
        </main>

        {/* Bottom nav estilo handoff */}
        <nav
          className="absolute z-[9999]"
          style={{
            left: "50%",
            transform: "translateX(-50%)",
            width: "calc(100% - 20px)",
            maxWidth: 370,
            bottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(18px) saturate(140%)",
            WebkitBackdropFilter: "blur(18px) saturate(140%)",
            borderRadius: 999,
            padding: 5,
            border: "1px solid rgba(255,255,255,0.6)",
            boxShadow: "0 12px 32px rgba(45,56,82,0.10), 0 1px 2px rgba(45,56,82,0.04)",
          }}
        >
          <div className="flex items-stretch justify-between gap-0">
            {/* Home + Schedule */}
            {navItems.slice(0, 2).map(({ path, icon, label }) => {
              const isActive = location.pathname === path;
              const NavIcon = icon;
              return (
                <Link
                  key={path}
                  to={path}
                  className={`press-scale flex flex-1 min-w-0 flex-col items-center justify-center gap-[2px] px-[4px] py-[8px] rounded-full transition-colors duration-300 ${
                    isActive ? "text-white" : "text-muted-foreground"
                  }`}
                  style={isActive ? { background: "#2D3852" } : undefined}
                >
                  <div className="p-0 rounded-xl">
                    <NavIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.8} color={isActive ? "#FFFFFF" : "#6E7892"} />
                  </div>
                  <span className={`text-[10px] font-medium tracking-[0.02em] text-center leading-tight truncate w-full px-0.5 ${isActive ? "opacity-100" : "opacity-80"}`} style={{ color: isActive ? "#FFFFFF" : "#6E7892" }}>
                    {label}
                  </span>
                </Link>
              );
            })}

            {/* Attendees dropdown */}
            <div ref={attendeesRef} style={{ position: "relative", flex: 1, display: "flex" }}>
              <AnimatePresence>
                {attendeesOpen && (
                  <Motion.div
                    initial={{ opacity: 0, scale: 0.82, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.82, y: 10 }}
                    transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 12px)",
                      left: "50%",
                      translateX: "-50%",
                      transformOrigin: "bottom center",
                      background: "rgba(255,255,255,0.96)",
                      backdropFilter: "blur(18px) saturate(140%)",
                      WebkitBackdropFilter: "blur(18px) saturate(140%)",
                      borderRadius: 18,
                      padding: 8,
                      boxShadow: "0 8px 28px rgba(45,56,82,0.18), 0 1px 3px rgba(45,56,82,0.06)",
                      border: "1px solid rgba(255,255,255,0.7)",
                      zIndex: 10000,
                      width: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    {[
                      { path: "/people", icon: Users, label: "People" },
                      { path: "/startups", icon: Building2, label: "Startups" },
                    ].map(({ path, icon: Icon, label }) => {
                      const isActive = location.pathname === path;
                      return (
                        <Link
                          key={path}
                          to={path}
                          className="transition-all duration-200"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            background: isActive ? "#2D3852" : "transparent",
                            borderRadius: 12,
                            border: "none",
                            outline: "none",
                            textDecoration: "none",
                            padding: "10px 12px 10px 6px",
                          }}
                        >
                          <Icon style={{ width: 17, height: 17, flexShrink: 0 }} strokeWidth={isActive ? 2 : 1.8} color={isActive ? "#FFFFFF" : "#6E7892"} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#FFFFFF" : "#2D3852", whiteSpace: "nowrap" }}>{label}</span>
                        </Link>
                      );
                    })}
                  </Motion.div>
                )}
              </AnimatePresence>
              <button
                onClick={() => setAttendeesOpen((v) => !v)}
                className={`press-scale flex flex-1 min-w-0 flex-col items-center justify-center gap-[2px] px-[4px] py-[8px] rounded-full transition-colors duration-300 ${
                  isAttendeesActive ? "text-white" : "text-muted-foreground"
                }`}
                style={isAttendeesActive ? { background: "#2D3852", border: "none", outline: "none" } : { background: "transparent", border: "none", outline: "none" }}
              >
                <div className="p-0 rounded-xl">
                  <Users className="h-[18px] w-[18px] shrink-0" strokeWidth={isAttendeesActive ? 2 : 1.8} color={isAttendeesActive ? "#FFFFFF" : "#6E7892"} />
                </div>
                <span className={`text-[10px] font-medium tracking-[0.02em] text-center leading-tight truncate w-full px-0.5 ${isAttendeesActive ? "opacity-100" : "opacity-80"}`} style={{ color: isAttendeesActive ? "#FFFFFF" : "#6E7892" }}>
                  Attendees
                </span>
              </button>
            </div>

            {/* Info */}
            {navItems.slice(2).map(({ path, icon, label }) => {
              const isActive = location.pathname === path;
              const NavIcon = icon;
              return (
                <Link
                  key={path}
                  to={path}
                  className={`press-scale flex flex-1 min-w-0 flex-col items-center justify-center gap-[2px] px-[4px] py-[8px] rounded-full transition-colors duration-300 ${
                    isActive ? "text-white" : "text-muted-foreground"
                  }`}
                  style={isActive ? { background: "#2D3852" } : undefined}
                >
                  <div className="p-0 rounded-xl">
                    <NavIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.8} color={isActive ? "#FFFFFF" : "#6E7892"} />
                  </div>
                  <span className={`text-[10px] font-medium tracking-[0.02em] text-center leading-tight truncate w-full px-0.5 ${isActive ? "opacity-100" : "opacity-80"}`} style={{ color: isActive ? "#FFFFFF" : "#6E7892" }}>
                    {label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
      <PushNotificationPrompt />
      <EventDetailsModal eventId={eventModalId} onClose={closeEventModal} />
    </div>
  );
}