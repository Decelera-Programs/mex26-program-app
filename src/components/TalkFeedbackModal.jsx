import { Component, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { MapPin } from "lucide-react";
import { listPendingTalkFeedback, submitTalkFeedback } from "../api/dataService";
import { SPRING } from "../lib/motion";

const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const REFRESH_MS = 60 * 1000;

// This modal lives in the app shell, so a rendering bug in it must never take the
// whole app down: on error it simply renders nothing.
class FeedbackBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function TalkFeedbackModal() {
  return (
    <FeedbackBoundary>
      <TalkFeedbackQueue />
    </FeedbackBoundary>
  );
}

// Asks for a 1-10 rating of every talk that has already finished, one modal after
// another (oldest first). It is not dismissable: a talk stops being asked about only
// once it has been answered. Same look as the 1:1 rating modals.
function TalkFeedbackQueue() {
  const [queue, setQueue] = useState([]);
  const answeredRef = useRef(new Set());

  const refresh = useCallback(async () => {
    try {
      const pending = await listPendingTalkFeedback();
      setQueue(pending.filter((talk) => !answeredRef.current.has(talk.id)));
    } catch {
      // Can't tell what is pending (offline, no profile yet): better no modal than a wrong one.
    }
  }, []);

  useEffect(() => {
    refresh();
    // A talk can end while the app is open, so look again every minute and when the
    // user comes back to the app.
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refresh]);

  const current = queue[0] || null;

  function handleAnswered(talkId) {
    answeredRef.current.add(talkId);
    setQueue((prev) => prev.filter((talk) => talk.id !== talkId));
  }

  return (
    <AnimatePresence mode="wait">
      {current ? (
        <RatingModal key={current.id} talk={current} remaining={queue.length} onAnswered={handleAnswered} />
      ) : null}
    </AnimatePresence>
  );
}

function RatingModal({ talk, remaining, onAnswered }) {
  const [rating, setRating] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | sending | error
  const sending = status === "sending";

  async function submit() {
    if (rating == null || sending) return;
    setStatus("sending");
    try {
      await submitTalkFeedback(talk.id, rating);
      onAnswered(talk.id);
    } catch {
      setStatus("error");
    }
  }

  return (
    <Motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(45,56,82,0.55)",
        zIndex: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <Motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="talk-feedback-title"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={SPRING}
        style={{ background: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%", maxWidth: 340, maxHeight: "88vh", overflowY: "auto" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
          <p
            id="talk-feedback-title"
            style={{ fontFamily: "Taviraj, serif", fontWeight: 500, fontSize: 19, color: "#2D3852", margin: 0 }}
          >
            How was this talk?
          </p>
          {remaining > 1 ? (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                color: "#0A859B",
                background: "#ECFAFD",
                borderRadius: 9999,
                padding: "3px 9px",
                whiteSpace: "nowrap",
              }}
            >
              {remaining} to rate
            </span>
          ) : null}
        </div>
        <p style={{ fontSize: 12, color: "#6E7892", lineHeight: 1.5, margin: "0 0 16px" }}>
          Your score helps us shape the next sessions. It takes five seconds.
        </p>

        <div style={{ background: "#F2F8FA", borderRadius: 14, padding: "12px 14px", marginBottom: 18 }}>
          <p style={{ fontFamily: "Taviraj, serif", fontWeight: 500, fontSize: 16, color: "#2D3852", margin: 0, lineHeight: 1.25 }}>
            {talk.title}
          </p>
          {talk.location ? (
            <p style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#6E7892", margin: "4px 0 0" }}>
              <MapPin size={11} color="#0A859B" />
              {talk.location}
            </p>
          ) : null}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8 }}>
          {RATINGS.map((value) => {
            const selected = rating === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                disabled={sending}
                onClick={() => setRating(value)}
                style={{
                  height: 44,
                  borderRadius: 12,
                  border: selected ? "1.5px solid #1FD0EF" : "1.5px solid #E4EAF0",
                  background: selected ? "#1FD0EF" : "#FFFFFF",
                  color: "#2D3852",
                  fontFamily: "Fustat, sans-serif",
                  fontWeight: selected ? 700 : 600,
                  fontSize: 15,
                  cursor: sending ? "default" : "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "#6E7892" }}>
          <span>1 · Not for me</span>
          <span>10 · Loved it</span>
        </div>

        {status === "error" ? (
          <p style={{ fontSize: 11, color: "#D9534F", margin: "12px 0 0" }}>Could not save your rating. Try again.</p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={rating == null || sending}
          style={{
            width: "100%",
            marginTop: 18,
            borderRadius: 12,
            border: "none",
            background: "#1FD0EF",
            color: "#2D3852",
            padding: "11px 0",
            fontFamily: "Fustat, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            cursor: rating == null || sending ? "default" : "pointer",
            opacity: rating == null || sending ? 0.55 : 1,
          }}
        >
          {sending ? "Saving…" : remaining > 1 ? "Send and continue" : "Send"}
        </button>
      </Motion.div>
    </Motion.div>
  );
}
