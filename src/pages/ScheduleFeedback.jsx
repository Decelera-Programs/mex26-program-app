import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, Star } from "lucide-react";
import moment from "moment";
import { motion as Motion } from "framer-motion";
import {
  getCurrentUser,
  getMyScheduleDayFeedback,
  listEvents,
  setMyScheduleEventFeedback,
} from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";

const STAR_ACTIVE = "#FFB950";
const STAR_IDLE = "#FFB950";

function slugifyEventTitle(rawTitle) {
  return String(rawTitle || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function feedbackKeyForEvent(eventTitle, dayNumber) {
  const safeTitle = slugifyEventTitle(eventTitle) || "event";
  return `${safeTitle}_${dayNumber}`;
}

export default function ScheduleFeedback() {
  const { day } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  function openEventModal(eventId) {
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.set("event", eventId);
    navigate(`${location.pathname}?${nextSearch.toString()}`);
  }
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [ratings, setRatings] = useState({});
  const [availableDayKeys, setAvailableDayKeys] = useState([]);

  const selectedDay = useMemo(() => {
    const parsed = moment(day, "YYYY-MM-DD", true);
    return parsed.isValid() ? parsed : moment().startOf("day");
  }, [day]);

  const dayKey = selectedDay.format("YYYY-MM-DD");
  const dayNumber = selectedDay.date();

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      try {
        const me = await getCurrentUser();
        if (cancelled) return;
        setUser(me);
        if (!me) return;

        const all = await listEvents();
        if (cancelled) return;
        const dayKeys = Array.from(
          new Set((all || []).map((event) => moment(event.start_time).startOf("day").format("YYYY-MM-DD"))),
        ).sort((a, b) => moment(a).diff(moment(b)));
        setAvailableDayKeys(dayKeys);
        const MEAL_TYPES = new Set(["meal", "meals", "food", "breakfast", "lunch", "dinner"]);
        const MEAL_KEYWORDS = ["desayuno", "comida", "cena", "breakfast", "lunch", "dinner", "brunch"];
        const isMealEvent = (event) => {
          if (MEAL_TYPES.has(String(event.type || "").toLowerCase().trim())) return true;
          const title = String(event.title || "").toLowerCase();
          return MEAL_KEYWORDS.some((kw) => title.includes(kw));
        };
        const isBusCall = (event) => String(event.title || "").toLowerCase().trim() === "bus call";
        const dayEvents = (all || [])
          .filter((event) => moment(event.start_time).isSame(selectedDay, "day") && !isMealEvent(event) && !isBusCall(event))
          .sort((a, b) => moment(a.start_time).diff(moment(b.start_time)));
        setEvents(dayEvents);
        setRatings(await getMyScheduleDayFeedback(dayKey));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [dayKey, selectedDay]);

  async function handleRate(eventId, value) {
    await setMyScheduleEventFeedback(dayKey, eventId, value);
    const targetEvent = events.find((event) => event.id === eventId);
    if (!targetEvent) return;
    const key = feedbackKeyForEvent(targetEvent.title, dayNumber);
    setRatings((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) return <LoadingState message="Preparing feedback form" />;
  if (!user) return <UserNotRegisteredError />;

  const activeDayIndex = availableDayKeys.findIndex((key) => key === dayKey);
  const canGoPrevDay = activeDayIndex > 0;
  const canGoNextDay = activeDayIndex >= 0 && activeDayIndex < availableDayKeys.length - 1;

  function goToPrevDay() {
    if (!canGoPrevDay) return;
    navigate(`/schedule/feedback/${availableDayKeys[activeDayIndex - 1]}`);
  }

  function goToNextDay() {
    if (!canGoNextDay) return;
    navigate(`/schedule/feedback/${availableDayKeys[activeDayIndex + 1]}`);
  }

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

        <Link
          to="/schedule"
          className="inline-flex items-center gap-1.5 mb-3"
          style={{ fontSize: 13, color: "#6E7892", fontFamily: "Fustat, sans-serif" }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to schedule
        </Link>

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
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Send us your feedback
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Rate each event from 1 to 5 stars</p>
          </Motion.div>

          <div
            className="schedule-day-nav-bar"
            style={{ border: "none", background: "transparent", padding: 0, marginTop: 14, borderRadius: 0 }}
          >
            <div className="schedule-day-nav-main">
              <button
                type="button"
                onClick={goToPrevDay}
                disabled={!canGoPrevDay}
                className="schedule-day-nav-btn"
                aria-label="Previous feedback day"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="schedule-day-current-btn"
                aria-label={`Selected day ${selectedDay.format("MMMM D")}`}
              >
                {selectedDay.format("MMMM D")}
              </button>
              <button
                type="button"
                onClick={goToNextDay}
                disabled={!canGoNextDay}
                className="schedule-day-nav-btn"
                aria-label="Next feedback day"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 mb-4">
          <h2 style={{ fontFamily: "Taviraj, serif", fontWeight: 600, fontSize: 18, color: "#2D3852" }}>
            {selectedDay.format("dddd, MMMM D")}
          </h2>
        </div>

        {events.length === 0 ? (
          <div
            className="rounded-[20px] border px-[18px] py-8 text-center"
            style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
          >
            <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852" }}>No events this day</p>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 4 }}>Choose another day to leave feedback.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {events.map((event, index) => {
              const key = feedbackKeyForEvent(event.title, dayNumber);
              const rating = Number(ratings[key] || 0);
              return (
                <Motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.03 }}
                  className="rounded-[20px] border"
                  style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
                >
                  <div className="px-[18px] pt-[16px] pb-[12px] flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852", lineHeight: 1.3 }}>
                        {event.title}
                      </p>
                      <p style={{ fontSize: 11, color: "#6E7892", marginTop: 3 }}>
                        {moment(event.start_time).format("HH:mm")} - {moment(event.end_time).format("HH:mm")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openEventModal(event.id)}
                      style={{ fontSize: 11, color: "#0A859B", fontWeight: 600, flexShrink: 0, lineHeight: 1.3, background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 4, marginRight: 6 }}
                    >
                      Details
                    </button>
                  </div>

                  <div
                    className="mx-[18px] mb-[14px] rounded-[14px] px-[14px] pt-[10px] pb-[8px] flex flex-col gap-[6px]"
                    style={{ background: "#2D3852" }}
                  >
                    <div className="flex items-center gap-8">
                      <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em" }}>1 — Forgettable</span>
                      <span style={{ fontSize: 9.5, color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", marginLeft: 40 }}>5 — Unbelievable</span>
                    </div>
                    <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[4px]">
                      {[1, 2, 3, 4, 5].map((value) => {
                        const active = value <= rating;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => handleRate(event.id, value)}
                            className="schedule-feedback-star-btn"
                            aria-label={`Rate ${event.title} ${value} stars`}
                            style={{ padding: "2px 3px" }}
                          >
                            <Star
                              className="h-6 w-6"
                              style={{
                                color: active ? STAR_ACTIVE : STAR_IDLE,
                                fill: active ? STAR_ACTIVE : "transparent",
                              }}
                            />
                          </button>
                        );
                      })}
                    </div>
                    {rating > 0 && (
                      <span style={{ fontSize: 11, color: "#FFB950", fontWeight: 600, fontFamily: "Fustat, sans-serif" }}>
                        {rating}/5
                      </span>
                    )}
                    </div>
                  </div>
                </Motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
