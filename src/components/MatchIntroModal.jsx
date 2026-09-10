import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion as Motion } from "framer-motion";
import { resolvePhotoUrl } from "../lib/photoUrl";
import { SPRING } from "../lib/motion";

const introKey = (id) => `decelera.match.${id}.intro`;

function alreadySeen(id) {
  try {
    return localStorage.getItem(introKey(id)) === "1";
  } catch {
    return false;
  }
}
function markSeen(id) {
  try {
    localStorage.setItem(introKey(id), "1");
  } catch {
    /* ignore */
  }
}

function Avatar({ person, size = 56 }) {
  const [failed, setFailed] = useState(false);
  const initials = (person?.full_name || "")
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const src = resolvePhotoUrl(person?.photo_url);
  const show = src && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: 16,
        background: "#EEF2F5",
        overflow: "hidden",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.round(size * 0.32),
        color: "#2D3852",
      }}
    >
      {show ? (
        <img
          src={src}
          alt={person.full_name}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

// One-time heads-up shown on Home the first time the user lands with today's
// match already assigned. "Seen" is remembered per match id in localStorage, so
// it appears once per day and never again for that match.
export default function MatchIntroModal({ match, onSeeDetails }) {
  const [open, setOpen] = useState(false);

  const close = () => {
    if (match?.id) markSeen(match.id);
    setOpen(false);
  };
  const seeDetails = () => {
    close();
    onSeeDetails?.();
  };

  useEffect(() => {
    if (!match?.id || !match?.counterpart) return undefined;
    if (match.my_feedback || alreadySeen(match.id)) return undefined;
    const t = setTimeout(() => setOpen(true), 450);
    return () => clearTimeout(t);
  }, [match?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !match?.counterpart) return null;

  const { counterpart, reason_text: topic, role } = match;
  const isFounder = role === "founder";
  const sub = counterpart.tagline || counterpart.company_name || (isFounder ? "Experience Maker" : "Founder");

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.45)",
        padding: "24px 14px",
        overflowY: "auto",
        display: "flex",
        alignItems: "center",
      }}
      onClick={close}
    >
      <Motion.div
        initial={{ opacity: 0, y: 20, scale: 0.965 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={SPRING}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 400,
          margin: "0 auto",
          borderRadius: 22,
          background: "#FFFFFF",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          overflow: "hidden",
        }}
      >
        <div style={{ background: "#2D3852", padding: "20px 20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1FD0EF" }} />
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: "#7FE3F4",
              }}
            >
              Today&apos;s connection
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <Avatar person={counterpart} size={56} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "Taviraj, Georgia, serif",
                  fontWeight: 400,
                  fontSize: 20,
                  lineHeight: 1.15,
                  color: "#FFFFFF",
                }}
              >
                {counterpart.full_name}
              </div>
              <div style={{ fontSize: 11.5, marginTop: 3, color: "rgba(255,255,255,0.6)" }}>{sub}</div>
            </div>
          </div>
        </div>

        <div style={{ padding: "18px 20px 20px" }}>
          {topic && (
            <div style={{ padding: "13px 14px", background: "#F2F8FA", borderRadius: 13 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "#6E7892",
                  fontWeight: 600,
                }}
              >
                Talk about
              </div>
              <div
                style={{
                  fontFamily: "Taviraj, Georgia, serif",
                  fontWeight: 400,
                  fontSize: 16,
                  color: "#2D3852",
                  lineHeight: 1.32,
                  marginTop: 5,
                }}
              >
                {topic}
              </div>
            </div>
          )}
          <p style={{ margin: "14px 0 0", fontSize: 12.5, color: "#6E7892", lineHeight: 1.5 }}>
            Find a moment during the day and have that conversation. No agenda, informal — it&apos;s a
            suggestion, not an event.
          </p>

          <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
            <button
              type="button"
              onClick={seeDetails}
              style={{
                flex: 1,
                background: "#2D3852",
                color: "#FFFFFF",
                border: "none",
                borderRadius: 13,
                padding: "12px 14px",
                fontFamily: "Fustat, sans-serif",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              See details
            </button>
            <button
              type="button"
              onClick={close}
              style={{
                background: "#F2F8FA",
                color: "#6E7892",
                border: "1px solid #E4EAF0",
                borderRadius: 13,
                padding: "12px 16px",
                fontFamily: "Fustat, sans-serif",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      </Motion.div>
    </div>,
    document.body,
  );
}
