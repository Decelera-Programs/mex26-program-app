import { useEffect, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { sendMatchConnect, submitMatchFeedback } from "../api/dataService";
import { resolvePhotoUrl } from "../lib/photoUrl";

function loadChecked(matchId) {
  try {
    const raw = localStorage.getItem(`decelera.match.${matchId}.q`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}
function saveChecked(matchId, set) {
  try {
    localStorage.setItem(`decelera.match.${matchId}.q`, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

const TAKEAWAYS = [
  { key: "idea", label: "Una idea" },
  { key: "contact", label: "Un contacto" },
  { key: "perspective", label: "Otra perspectiva" },
  { key: "nothing", label: "Nada", muted: true },
];

function dayLabel(raw) {
  if (!raw) return "";
  const then = new Date(raw);
  if (Number.isNaN(then.getTime())) return "";
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date()) - startOf(then)) / 86400000);
  if (diff <= 0) return "";
  if (diff === 1) return "ayer";
  return `hace ${diff} días`;
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
        background: "#1FD0EF",
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
  const [fbStep, setFbStep] = useState("talked"); // talked | takeaway
  const [connectSent, setConnectSent] = useState(Boolean(match?.my_connect));
  const [checked, setChecked] = useState(() => loadChecked(match?.id));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setExpanded(false);
    setFb(match?.my_feedback ?? null);
    setFbStep("talked");
    setConnectSent(Boolean(match?.my_connect));
    setChecked(loadChecked(match?.id));
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

  function toggleQuestion(i) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      saveChecked(match.id, next);
      return next;
    });
  }

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

  const metaLine = fb
    ? fb.talked
      ? "Feedback enviado · gracias"
      : "Marcaste: aún no habéis hablado"
    : `${questions.length} pregunta${questions.length === 1 ? "" : "s"} lista${questions.length === 1 ? "" : "s"}${
        isFounder && opener ? " · 1 frase para arrancar" : ""
      }`;

  const pillFor = (dark) => ({
    background: dark ? "rgba(255,255,255,0.1)" : "#F2F8FA",
    border: dark ? "1px solid rgba(255,255,255,0.16)" : "1px solid #DCE6EC",
    borderRadius: 999,
    color: dark ? "#FFFFFF" : "#2D3852",
    fontSize: 11,
    fontWeight: 600,
    padding: "6px 12px",
    cursor: "pointer",
  });

  // Two-step feedback: "did you talk?" -> "what did you take away?". Rendered in
  // the expanded body (dark) and, for a stale follow-up card, in the collapsed
  // header strip (light).
  function renderFeedback(dark) {
    const pill = pillFor(dark);
    const labelColor = dark ? "rgba(255,255,255,0.55)" : "#6E7892";
    if (fb) {
      return (
        <span style={{ fontSize: 11, color: dark ? "rgba(255,255,255,0.6)" : "#6E7892" }}>
          {fb.talked
            ? fb.takeaway === "nothing"
              ? "Gracias por el feedback."
              : "Gracias — nos alegra que sirviera."
            : "Ok, quizá en otro momento."}
        </span>
      );
    }
    if (fbStep === "talked") {
      return (
        <>
          <span style={{ fontSize: 11, color: labelColor }}>¿Hablasteis?</span>
          <button type="button" disabled={busy} style={pill} onClick={() => setFbStep("takeaway")}>
            Sí
          </button>
          <button type="button" disabled={busy} style={pill} onClick={() => sendFeedback({ talked: false })}>
            Aún no
          </button>
        </>
      );
    }
    return (
      <>
        <span style={{ fontSize: 11, color: labelColor }}>¿Qué te llevaste?</span>
        {TAKEAWAYS.map((t) => (
          <button
            key={t.key}
            type="button"
            disabled={busy}
            style={{
              ...pill,
              ...(t.muted
                ? dark
                  ? { color: "rgba(255,255,255,0.65)", background: "transparent" }
                  : { color: "#9AA3B8", background: "transparent", border: "1px solid #E4EAF0" }
                : {}),
            }}
            onClick={() => sendFeedback({ talked: true, takeaway: t.key })}
          >
            {t.label}
          </button>
        ))}
      </>
    );
  }

  return (
    <Motion.div
      key="match-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.26, ease: [0.23, 1, 0.32, 1] }}
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
                ? `¿Qué tal fue?${dayLabel(match.match_date) ? ` · ${dayLabel(match.match_date)}` : ""}`
                : "Tu conexión de hoy"}
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
            padding: "12px 16px 14px",
            borderTop: "1px solid #F0F3F6",
            display: "flex",
            alignItems: "center",
            gap: 9,
            flexWrap: "wrap",
          }}
        >
          {renderFeedback(false)}
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
            transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }}
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
                  Hablad de
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

            {/* questions checklist */}
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
                  Pregúntale
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                  {questions.map((q, i) => {
                    const on = checked.has(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleQuestion(i)}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                        }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={on ? "#1FD0EF" : "#B9C1D4"}
                          strokeWidth="2"
                          style={{ flexShrink: 0, marginTop: 1 }}
                        >
                          <rect x="4" y="4" width="16" height="16" rx="4" fill={on ? "#1FD0EF" : "none"} />
                          {on && <path d="M8 12.5l2.5 2.5 5-6" stroke="#FFFFFF" />}
                        </svg>
                        <span
                          style={{
                            fontSize: 12.5,
                            lineHeight: 1.4,
                            color: on ? "#8A93A6" : "#2D3852",
                            textDecoration: on ? "line-through" : "none",
                          }}
                        >
                          {q}
                        </span>
                      </button>
                    );
                  })}
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
                    Avisado
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
                    </svg>
                    Quiero hablar
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
                Ver ficha
              </button>
            </div>

            {/* feedback */}
            <div
              style={{
                marginTop: 14,
                padding: "13px 18px",
                background: "#2D3852",
                display: "flex",
                alignItems: "center",
                gap: 9,
                flexWrap: "wrap",
              }}
            >
              {renderFeedback(true)}
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </Motion.div>
  );
}
