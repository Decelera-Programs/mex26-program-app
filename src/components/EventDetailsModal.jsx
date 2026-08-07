import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, MapPin } from "lucide-react";
import moment from "moment";
import { motion as Motion } from "framer-motion";
import { getEventById, listEventPeople } from "../api/dataService";
import PersonCard from "./PersonCard";
import Loader from "./Loader";

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
        <div className="min-h-[240px] flex items-center justify-center">
          <Loader size={72} />
        </div>
      );
    }
    if (!event) {
      return (
        <div className="p-6 text-center">
          <p className="text-muted-foreground text-sm">{loadError || "Event not found"}</p>
        </div>
      );
    }

    const startTime = moment(event.start_time);
    const endTime = moment(event.end_time);
    const duration = moment.duration(endTime.diff(startTime));
    const durationText =
      duration.asHours() >= 1 ? `${Math.floor(duration.asHours())}h ${duration.minutes()}m` : `${duration.minutes()}m`;
    const eventDetailCardClass = "event-modal-detail-card event-detail-info-row";

    return (
      <>
        <div className="event-modal-header">
          <div className="event-modal-hero">
            <div
              className="decelera-breathe-mark pointer-events-none absolute -right-12 -bottom-12 h-[170px] w-[170px] rounded-full"
              style={{ background: "rgba(45, 56, 82, 0.18)" }}
            />
            <div className="event-detail-title-row">
              <h1 className="text-2xl font-bold text-foreground leading-tight font-display tracking-tight min-w-0">
                {event.title}
              </h1>
            </div>
            {event.description ? (
              <p className="event-modal-description text-sm text-foreground/80 leading-relaxed">{event.description}</p>
            ) : null}
          </div>
        </div>

        <div className="event-modal-content">
          {eventPeople.length > 0 ? (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
                {eventPeople.length === 1 ? "Host" : "Hosts"}
              </p>
              <div className="card-list">
                {eventPeople.map((person, index) => (
                  <PersonCard key={person.id} person={person} index={index} />
                ))}
              </div>
            </div>
          ) : null}

          <div className={eventDetailCardClass}>
            <div className="event-detail-info-icon">
              <Clock className="h-5 w-5 text-primary" />
            </div>
            <div className="event-detail-info-content">
              <p className="text-sm font-semibold text-foreground">
                {startTime.format("h:mm A")} - {endTime.format("h:mm A")}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {durationText} · {startTime.format("dddd, MMMM D")}
              </p>
            </div>
          </div>

          <div className={eventDetailCardClass}>
            <div className="event-detail-info-icon">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div className="event-detail-info-content">
              <p className="text-sm font-semibold text-foreground">{event.location}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Event venue</p>
            </div>
          </div>

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
        background: "rgba(0, 0, 0, 0.45)",
        padding: "24px 12px",
        overflowY: "auto",
      }}
      onClick={onClose}
    >
      <Motion.div
        initial={{ opacity: 0, y: 20, scale: 0.78 }}
        animate={{ opacity: 1, y: 0, scale: 0.78 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          margin: "0 auto",
          transformOrigin: "top center",
          borderRadius: 24,
          border: "1px solid hsl(var(--border) / 0.6)",
          background: "#F2F8FA",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {content}
      </Motion.div>
    </div>,
    document.body,
  );
}
