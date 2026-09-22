import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, MapPin, X } from "lucide-react";
import moment from "moment";
import { motion as Motion } from "framer-motion";
import { getEventById, listEventPeople } from "../api/dataService";
import PersonCard from "./PersonCard";
import Loader from "./Loader";
import { SPRING } from "../lib/motion";

function DetailRow({ icon, title, caption }) {
  return (
    <div
      className="rounded-[20px] border"
      style={{
        background: "#FFFFFF",
        borderColor: "#EEF2F5",
        padding: "14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          borderRadius: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(31,208,239,0.10)",
          border: "1px solid rgba(31,208,239,0.15)",
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#2D3852" }}>{title}</p>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6E7892" }}>{caption}</p>
      </div>
    </div>
  );
}

export default function EventDetailsModal({ eventId, onClose }) {
  const [event, setEvent] = useState(null);
  const [eventPeople, setEventPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function fetchEvent() {
      setLoading(true);
      setLoadError("");
      try {
        const found = await getEventById(eventId);
        if (cancelled) return;
        setEvent(found || null);
        if (!found?.id) {
          setEventPeople([]);
          return;
        }
        const linkedPeople = await listEventPeople(found.id).catch(() => []);
        if (!cancelled) setEventPeople(linkedPeople);
      } catch (error) {
        if (cancelled) return;
        setEvent(null);
        setEventPeople([]);
        setLoadError(error instanceof Error ? error.message : "Could not load event");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchEvent();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [eventId, onClose]);

  const content = useMemo(() => {
    if (loading) {
      return (
        <div style={{ minHeight: 260, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader size={68} />
        </div>
      );
    }
    if (!event) {
      return (
        <div style={{ padding: "56px 24px", textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "#6E7892", margin: 0 }}>{loadError || "Event not found"}</p>
        </div>
      );
    }

    const startTime = moment(event.start_time);
    const endTime = moment(event.end_time);
    const duration = moment.duration(endTime.diff(startTime));
    const durationText =
      duration.asHours() >= 1 ? `${Math.floor(duration.asHours())}h ${duration.minutes()}m` : `${duration.minutes()}m`;

    return (
      <>
        <div style={{ position: "relative", padding: "18px 18px 0" }}>
          <div
            style={{
              position: "relative",
              overflow: "hidden",
              borderRadius: 20,
              background: "#FAF3DC",
              border: "1px solid #EEF2F5",
              padding: "20px 44px 18px 20px",
              boxShadow: "0 10px 26px rgba(45, 56, 82, 0.08)",
            }}
          >
            <div
              className="decelera-breathe-mark pointer-events-none absolute"
              style={{
                right: -48,
                bottom: -48,
                height: 170,
                width: 170,
                borderRadius: 9999,
                background: "rgba(45, 56, 82, 0.14)",
              }}
            />
            <h1
              style={{
                position: "relative",
                fontFamily: "Taviraj, serif",
                fontWeight: 300,
                fontSize: 24,
                lineHeight: 1.18,
                letterSpacing: "-0.02em",
                color: "#2D3852",
                margin: 0,
              }}
            >
              {event.title}
            </h1>
            {event.description ? (
              <p style={{ position: "relative", marginTop: 10, fontSize: 13, lineHeight: 1.55, color: "#4A5573" }}>
                {event.description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press-scale"
            style={{
              position: "absolute",
              top: 30,
              right: 30,
              width: 30,
              height: 30,
              borderRadius: 9999,
              border: "none",
              background: "rgba(45, 56, 82, 0.08)",
              color: "#2D3852",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: "16px 20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <DetailRow
            icon={<Clock size={16} color="#0A859B" strokeWidth={1.8} />}
            title={`${startTime.format("h:mm A")} – ${endTime.format("h:mm A")}`}
            caption={`${durationText} · ${startTime.format("dddd, MMMM D")}`}
          />

          {event.location ? (
            <DetailRow
              icon={<MapPin size={16} color="#0A859B" strokeWidth={1.8} />}
              title={event.location}
              caption="Event venue"
            />
          ) : null}

          {eventPeople.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "#9AA3B8",
                  margin: "4px 0 10px",
                }}
              >
                {eventPeople.length === 1 ? "Host" : "Hosts"}
              </p>
              <div className="card-list">
                {eventPeople.map((person, index) => (
                  <PersonCard key={person.id} person={person} index={index} />
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    );
  }, [event, eventPeople, loadError, loading, onClose]);

  if (!eventId) return null;
  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(15, 23, 42, 0.45)",
        padding: "24px 12px",
        overflowY: "auto",
      }}
      onClick={onClose}
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
          borderRadius: 24,
          background: "#F2F8FA",
          boxShadow: "0 24px 60px rgba(15, 23, 42, 0.35)",
          overflow: "hidden",
        }}
      >
        {content}
      </Motion.div>
    </div>,
    document.body,
  );
}
