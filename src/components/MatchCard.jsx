import { useEffect, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { sendMatchConnect, submitMatchFeedback } from "../api/dataService";
import { resolvePhotoUrl } from "../lib/photoUrl";
import { DUR, SPRING, SPRING_GENTLE } from "../lib/motion";

const RATINGS = [
  { key: "great", emoji: "🔥", label: "Very useful" },
  { key: "good", emoji: "👍", label: "Went well" },
  { key: "meh", emoji: "😐", label: "Not much" },
];

const TAKEAWAYS = [
  { key: "idea", label: "An idea" },
  { key: "contact", label: "A contact" },
  { key: "perspective", label: "A new angle" },
  { key: "collab", label: "A possible collaboration" },
];

function dayLabel(raw) {
  if (!raw) return "";
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return "";
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(then)) / 86400000);
  if (diff <= 0) return "";
  if (diff === 1) return "yesterday";
  return `${diff} days ago`;
}

function ChevronIcon({ dir = "down", color = "#6E7892" }) {
  const d = dir === "up" ? "M18 15l-6-6-6 6" : "M9 18l6-6-6-6";
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

function Avatar({ person, size, radius, fontSize }) {
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
        borderRadius: radius,
        background: "#EEF2F5",
        overflow: "hidden",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize,
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

function markOpened(matchId) {
  try {
    localStorage.setItem(`decelera.match.${matchId}.opened`, "1");
  } catch {
    /* ignore */
  }
}

export default function MatchCard({ match, onClick, stale = false, onEngaged, highlight = false }) {
  const [expanded, setExpanded] = useState(false);
  const [fb, setFb] = useState(match?.my_feedback ?? null);
  const [fbStep, setFbStep] = useState("talked"); // talked | rating | takeaway
  const [pendingRating, setPendingRating] = useState(null);
  const [dismissed, setDismissed] = useState(false); // "Not yet" — soft, not persisted
  const [connectSent, setConnectSent] = useState(Boolean(match?.my_connect));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setFb(match?.my_feedback ?? null);
    setFbStep("talked");
    setPendingRating(null);
    setDismissed(false);
    setConnectSent(Boolean(match?.my_connect));
  }, [match?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened straight from a match notification — show the whole brief.
  useEffect(() => {
    if (!highlight) return;
    setExpanded(true);
    engage();
  }, [highlight]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!match?.counterpart) return null;

  const { counterpart, reason_text: topic, opener, why = [], questions = [], em_blurb: emBlurb, role } = match;
  const isFounder = role === "founder";
  // "yes"/"wont" are a real answer; "not_yet" is never persisted (see below).
  const settled = fb?.talked === "yes" || fb?.talked === "wont" || fb?.talked === true;

  // The user has acted on this card today — stop any "needs attention" pulse.
  function engage() {
    if (!match?.id) return;
    markOpened(match.id);
    onEngaged?.(match.id);
  }

  function toggleExpanded() {
    if (!expanded) engage();
    setExpanded((v) => !v);
  }

  async function sendFeedback(payload) {
    engage();
    setBusy(true);
    try {
      const res = await submitMatchFeedback(match.id, payload);
      setFb(res?.my_feedback ?? payload);
    } catch {
      setFbStep("talked");
      setPendingRating(null);
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    engage();
    setConnectSent(true);
    try {
      await sendMatchConnect(match.id);
    } catch {
      setConnectSent(false);
    }
  }

  const metaLine = settled
    ? "Feedback sent · thanks"
    : `${questions.length} question${questions.length === 1 ? "" : "s"} ready${
        isFounder && opener ? " · 1 opener line" : ""
      }`;

  // Three-step feedback — "did you talk?" -> "how did it go?" -> "what did you take
  // away?" (only after a good/great rating). This is the highest-weight block on the
  // card once there's something to rate, so it always gets its own colored section
  // with big tap targets, never a thin strip of small pills.
  function renderFeedback(dark) {
    const cardColor = dark ? "#FFFFFF" : "#2D3852";
    const subColor = dark ? "rgba(255,255,255,0.6)" : "#6E7892";
    const bigButton = (accent) => ({
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: "13px 14px",
      borderRadius: 13,
      fontFamily: "Fustat, sans-serif",
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer",
      border: "none",
      background: accent
        ? dark
          ? "#1FD0EF"
          : "#2D3852"
        : dark
          ? "rgba(255,255,255,0.1)"
          : "#F2F8FA",
      color: accent ? (dark ? "#2D3852" : "#FFFFFF") : dark ? "#FFFFFF" : "#2D3852",
    });
    const softLink = {
      background: "transparent",
      border: "none",
      color: subColor,
      fontSize: 11.5,
      fontWeight: 600,
      textDecoration: "underline",
      cursor: "pointer",
      padding: "6px 0",
    };

    if (settled) {
      const thanks =
        fb.talked === "wont"
          ? "Noted, thanks."
          : fb.rating === "meh"
            ? "Thanks for the feedback."
            : "Glad it helped — thanks.";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18 }}>{fb.talked === "wont" ? "👌" : fb.rating === "meh" ? "🙏" : "🎉"}</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: cardColor }}>{thanks}</span>
        </div>
      );
    }

    if (dismissed) {
      return (
        <span style={{ fontSize: 12, color: subColor }}>OK, we&apos;ll ask again later.</span>
      );
    }

    if (fbStep === "talked") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: cardColor }}>
            Did you talk with {counterpart.full_name?.split(/\s+/)[0] || "them"}?
          </span>
          <button type="button" disabled={busy} style={bigButton(true)} onClick={() => setFbStep("rating")}>
            Yes, we talked
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={busy}
              style={{ ...bigButton(false), flex: 1 }}
              onClick={() => {
                engage();
                setDismissed(true);
              }}
            >
              Not yet
            </button>
            <button
              type="button"
              disabled={busy}
              style={{ ...bigButton(false), flex: 1, opacity: 0.75 }}
              onClick={() => sendFeedback({ talked: "wont" })}
            >
              Won&apos;t happen
            </button>
          </div>
        </div>
      );
    }

    if (fbStep === "rating") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: cardColor }}>How did it go?</span>
          <div style={{ display: "flex", gap: 8 }}>
            {RATINGS.map((r) => (
              <button
                key={r.key}
                type="button"
                disabled={busy}
                style={{
                  ...bigButton(false),
                  flex: 1,
                  flexDirection: "column",
                  gap: 4,
                  padding: "12px 6px",
                }}
                onClick={() => {
                  if (r.key === "meh") {
                    sendFeedback({ talked: "yes", rating: "meh" });
                  } else {
                    setPendingRating(r.key);
                    setFbStep("takeaway");
                  }
                }}
              >
                <span style={{ fontSize: 20, lineHeight: 1 }}>{r.emoji}</span>
                <span style={{ fontSize: 10.5 }}>{r.label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    // takeaway (optional, only reached after a "great"/"good" rating)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: cardColor }}>What did you take away?</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {TAKEAWAYS.map((t) => (
            <button
              key={t.key}
              type="button"
              disabled={busy}
              style={{
                background: dark ? "rgba(255,255,255,0.1)" : "#F2F8FA",
                border: dark ? "1px solid rgba(255,255,255,0.16)" : "1px solid #DCE6EC",
                borderRadius: 999,
                color: dark ? "#FFFFFF" : "#2D3852",
                fontSize: 11.5,
                fontWeight: 600,
                padding: "8px 13px",
                cursor: "pointer",
              }}
              onClick={() => sendFeedback({ talked: "yes", rating: pendingRating, takeaway: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          style={softLink}
          onClick={() => sendFeedback({ talked: "yes", rating: pendingRating })}
        >
          Skip
        </button>
      </div>
    );
  }

  return (
    <Motion.div
      key="match-card"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={SPRING}
      className="w-full max-w-full box-border rounded-[20px] overflow-hidden"
      style={{
        background: expanded ? "#FFFFFF" : "#FFFFFF",
        border: expanded ? "1px solid #E4EAF0" : "1px solid #E4EAF0",
        boxShadow: expanded
          ? "0 10px 30px rgba(45,56,82,0.14), 0 1px 3px rgba(45,56,82,0.06)"
          : "0 4px 14px rgba(45,56,82,0.06)",
      }}
    >
      {/* ---------- header (collapsed summary / expanded band) ---------- */}
      <button
        type="button"
        onClick={toggleExpanded}
        className="w-full text-left"
        style={{
          border: "none",
          cursor: "pointer",
          background: expanded ? "#2D3852" : "#FFFFFF",
          padding: expanded ? "16px 18px" : "14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: expanded ? 12 : 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1FD0EF" }} />
            <span
              style={{
                fontSize: 10.5,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                fontWeight: 600,
                color: expanded ? "#7FE3F4" : "#0A859B",
              }}
            >
              {stale
                ? `How did it go?${dayLabel(match.match_date) ? ` · ${dayLabel(match.match_date)}` : ""}`
                : "Today's connection"}
            </span>
          </div>
          <ChevronIcon dir={expanded ? "up" : "down"} color={expanded ? "rgba(255,255,255,0.5)" : "#6E7892"} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: expanded ? 13 : 12 }}>
          <Avatar
            person={counterpart}
            size={expanded ? 52 : 44}
            radius={expanded ? 13 : 12}
            fontSize={expanded ? 16 : 14}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: "Taviraj, Georgia, serif",
                fontWeight: 400,
                fontSize: expanded ? 19 : 16,
                lineHeight: 1.15,
                color: expanded ? "#FFFFFF" : "#2D3852",
              }}
            >
              {counterpart.full_name}
            </div>
            <div
              style={{
                fontSize: 11.5,
                marginTop: expanded ? 3 : 2,
                color: expanded ? "rgba(255,255,255,0.6)" : "#6E7892",
                whiteSpace: expanded ? "normal" : "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {expanded ? counterpart.tagline || counterpart.company_name || "Experience Maker" : topic}
            </div>
          </div>
        </div>

        {!expanded && !stale && (
          <div
            style={{
              marginTop: 11,
              paddingTop: 10,
              borderTop: "1px solid #F0F3F6",
              fontSize: 10.5,
              fontWeight: 500,
              color: "#9AA3B8",
            }}
          >
            {metaLine}
          </div>
        )}
      </button>

      {/* ---------- stale follow-up: ask for feedback right here ---------- */}
      {stale && !expanded && (
        <div
          style={{
            padding: "14px 16px 16px",
            background: "#ECFAFD",
            borderTop: "1px solid #D6EEF5",
          }}
        >
          <div
            style={{
              opacity: busy ? 0.55 : 1,
              pointerEvents: busy ? "none" : "auto",
              transition: "opacity 0.15s ease",
            }}
          >
            {renderFeedback(false)}
          </div>
        </div>
      )}

      {/* ---------- expanded body ---------- */}
      <AnimatePresence initial={false}>
        {expanded && (
          <Motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: SPRING_GENTLE,
              opacity: { duration: DUR.expand * 0.7, delay: DUR.expand * 0.12, ease: "linear" },
            }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "16px 18px 0" }}>
              {/* EM-facing: why they want to talk to you */}
              {!isFounder && emBlurb && (
                <p style={{ margin: 0, fontSize: 12.5, color: "#4A5573", lineHeight: 1.55 }}>{emBlurb}</p>
              )}

              {/* why you two */}
              {why.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: !isFounder && emBlurb ? 12 : 0 }}>
                  {why.map((w, i) => (
                    <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                      <span
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: "50%",
                          background: "#1FD0EF",
                          marginTop: 6,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12, color: "#4A5573", lineHeight: 1.45 }}>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* topic */}
            {topic && (
              <div style={{ margin: "14px 18px 0", padding: "13px 14px", background: "#F2F8FA", borderRadius: 14 }}>
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
                    fontSize: 16.5,
                    color: "#2D3852",
                    lineHeight: 1.32,
                    marginTop: 5,
                  }}
                >
                  {topic}
                </div>
              </div>
            )}

            {/* questions — a few angles to pull on, not a checklist */}
            {questions.length > 0 && (
              <div style={{ padding: "16px 18px 0" }}>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "#6E7892",
                    fontWeight: 600,
                    marginBottom: 10,
                  }}
                >
                  {isFounder ? "Ask them" : "What they might ask you"}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {questions.map((q, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                      <span
                        style={{
                          flexShrink: 0,
                          width: 18,
                          fontSize: 12,
                          fontWeight: 700,
                          color: "#1FD0EF",
                          lineHeight: 1.45,
                        }}
                      >
                        {i + 1}.
                      </span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: "#2D3852" }}>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* opener (founders only) */}
            {isFounder && opener && (
              <div style={{ margin: "17px 18px 0", paddingLeft: 11, borderLeft: "2px solid #1FD0EF" }}>
                <span style={{ fontSize: 11.5, fontStyle: "italic", color: "#6E7892", lineHeight: 1.5 }}>
                  &ldquo;{opener}&rdquo;
                </span>
              </div>
            )}

            {/* actions */}
            <div style={{ padding: "16px 18px 4px", display: "flex", gap: 9 }}>
              <button
                type="button"
                onClick={connect}
                disabled={connectSent}
                style={{
                  flex: 1,
                  background: connectSent ? "#EAF7EE" : "#2D3852",
                  color: connectSent ? "#3E7D4F" : "#FFFFFF",
                  border: "none",
                  borderRadius: 13,
                  padding: "12px 14px",
                  fontFamily: "Fustat, sans-serif",
                  fontSize: 12.5,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 7,
                  cursor: connectSent ? "default" : "pointer",
                }}
              >
                {connectSent ? (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Notified
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
                    </svg>
                    I&apos;d like to talk
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClick}
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
                View profile
              </button>
            </div>

            {/* feedback — own section, not a thin footer strip */}
            <div
              style={{
                marginTop: 16,
                padding: "16px 18px",
                background: "#2D3852",
              }}
            >
              <div
                style={{
                  opacity: busy ? 0.55 : 1,
                  pointerEvents: busy ? "none" : "auto",
                  transition: "opacity 0.15s ease",
                }}
              >
                {renderFeedback(true)}
              </div>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>
  );
}
