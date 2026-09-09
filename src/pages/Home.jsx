import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser, getHomeDailyContent, getMyDailyCheckin, getMyMatches, getOneOnOneAudio, listEvents, listMyOneOnOnes, listPeople, submitMyDailyCheckin } from "../api/dataService";
import MatchCard from "../components/MatchCard";
import { Leaf, ArrowRight, CalendarDays, ChevronRight, MapPin, Users, Play, Pause, Mic } from "lucide-react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { PROGRAM_TIMEZONE, getTodayKey } from "../lib/dateTime";

// TODO: set the real Decelera México 2026 start date.
const PROGRAM_START_DATE = "2026-05-23";

const FALLBACK_HERO_CONTENT = {
  phase_label: "",
  badge_text: `TODAY · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: PROGRAM_TIMEZONE }).format(new Date())}`,
  title: "Decelera.",
  subtitle: (() => {
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: PROGRAM_TIMEZONE }).format(new Date());
    const diff = Math.ceil((new Date(PROGRAM_START_DATE) - new Date(todayStr)) / 86400000);
    return diff > 0 ? `${diff} days until the program` : "Decelera.";
  })(),
  body_text: "Slow down before you scale. We start the week soft - long walks, no laptops before lunch, dinners that run late.",
  reflection_text: "What would today look like if you trusted the week to do its work?",
};

const FALLBACK_PODCAST = {
  url: "https://ewhruuwvarxthbgimxyf.supabase.co/storage/v1/object/public/podcasts/WElcome%20to%20decelera.m4a",
  title: "Welcome to Decelera",
};

function dateKeyInProgramTz(raw) {
  if (!raw) return null;
  const str = String(raw).trim().replace(" ", "T");
  const withTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(str) ? str : `${str}Z`;
  const d = new Date(withTz);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: PROGRAM_TIMEZONE }).format(d);
}

const CHECKIN_QUESTIONS = [
  { id: "energy",     prompt: "What kind of energy are you carrying today?",          kind: "scale", anchors: ["Drained",     "Energized"]  },
  { id: "clarity",    prompt: "How clear does your thinking feel right now?",         kind: "scale", anchors: ["Overwhelmed", "Clear"]     },
  { id: "connection", prompt: "How connected do you feel to the people around you?",  kind: "scale", anchors: ["Isolated",    "Connected"]  },
];

export default function Home() {
  function parseEventDate(rawDate) {
    if (!rawDate) return null;
    if (rawDate instanceof Date) return Number.isNaN(rawDate.getTime()) ? null : rawDate;
    const raw = String(rawDate).trim();
    if (!raw) return null;
    const normalized = raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw;
    // Naive timestamps are floating wall-clock time (the published Mexico schedule).
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function toDateKeyInTimezone(rawDate) {
    const date = parseEventDate(rawDate);
    if (!date) return null;
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  function getEventStart(event) {
    return event?.start_time || event?.startTime || null;
  }

  function getEventDateKeyCandidates(event) {
    const startRaw = getEventStart(event);
    const candidates = new Set();
    const raw = String(startRaw || "").trim();
    if (raw) {
      const isoLike = raw.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(isoLike)) candidates.add(isoLike);
      const spaced = raw.split(" ")[0];
      if (/^\d{4}-\d{2}-\d{2}$/.test(spaced)) candidates.add(spaced);
    }
    const tzKey = toDateKeyInTimezone(startRaw);
    if (tzKey) candidates.add(tzKey);
    return candidates;
  }

  const navigate = useNavigate();
  const [heroContent, setHeroContent] = useState(FALLBACK_HERO_CONTENT);
  const [podcastContent, setPodcastContent] = useState(FALLBACK_PODCAST);
  const [events, setEvents] = useState([]);
  const [peoplePreview, setPeoplePreview] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [myOneOnOnesCount, setMyOneOnOnesCount] = useState(0);
  const [todayMatch, setTodayMatch] = useState(null);
  const [pendingMatches, setPendingMatches] = useState([]);
  const [myOneOnOnesWithoutAudio, setMyOneOnOnesWithoutAudio] = useState(0);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);
  const [checkinStep, setCheckinStep] = useState(0);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const [checkinError, setCheckinError] = useState("");
  const [checkinAnswers, setCheckinAnswers] = useState({});
  const checkinOpenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const todayKey = getTodayKey();

    async function loadHomeData() {
      try {
        const [homeData, checkinData, peopleData, oneOnOnesData, userData, matchData] = await Promise.all([
          getHomeDailyContent(todayKey).catch(() => null),
          getMyDailyCheckin(todayKey).catch(() => null),
          listPeople().catch(() => []),
          listMyOneOnOnes().catch(() => []),
          getCurrentUser().catch(() => null),
          getMyMatches().catch(() => ({ today: null, pending: [] })),
        ]);
        if (cancelled) return;
        if (userData) setCurrentUser(userData);
        setTodayMatch(matchData?.today || null);
        setPendingMatches(Array.isArray(matchData?.pending) ? matchData.pending : []);

        if (homeData) {
          setHeroContent({
            phase_label: homeData.phase_label || FALLBACK_HERO_CONTENT.phase_label,
            badge_text: homeData.badge_text || FALLBACK_HERO_CONTENT.badge_text,
            title: homeData.title || FALLBACK_HERO_CONTENT.title,
            subtitle: homeData.subtitle || FALLBACK_HERO_CONTENT.subtitle,
            body_text: homeData.body_text || FALLBACK_HERO_CONTENT.body_text,
            reflection_text: homeData.reflection_text || FALLBACK_HERO_CONTENT.reflection_text,
          });
          setPodcastContent({
            url: homeData.podcast_url || FALLBACK_PODCAST.url,
            title: homeData.podcast_title || FALLBACK_PODCAST.title,
            duration: homeData.podcast_duration_sec || null,
          });
        }
        if (checkinData?.already_submitted) {
          setCheckinDone(true);
        }

        if (Array.isArray(peopleData) && peopleData.length) {
          setPeoplePreview(peopleData);
        }
        const oneOnOnes = Array.isArray(oneOnOnesData) ? oneOnOnesData : [];
        setMyOneOnOnesCount(oneOnOnes.length);

        if (oneOnOnes.length > 0 && userData?.contact_type === "experience_maker") {
          const audioResults = await Promise.all(
            oneOnOnes.map((oo) => getOneOnOneAudio(oo.id).catch(() => null))
          );
          if (!cancelled) {
            setMyOneOnOnesWithoutAudio(audioResults.filter((r) => !r?.active_audio?.url).length);
          }
        }
      } catch {
        if (!cancelled) setHeroContent(FALLBACK_HERO_CONTENT);
      }
    }

    async function loadEventsWithRetry() {
      for (let i = 0; i < 8; i += 1) {
        try {
          const data = await listEvents();
          if (cancelled) return;
          if (Array.isArray(data) && data.length > 0) {
            setEvents(data);
            return;
          }
        } catch {
          // Retry to absorb transient auth/session timing.
        }
        if (i < 7) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!cancelled) setEvents([]);
    }

    loadHomeData();
    loadEventsWithRetry();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!checkinOpen) return;

    function handleOutsidePointerDown(event) {
      const target = event.target;
      if (checkinOpenRef.current && !checkinOpenRef.current.contains(target)) {
        setCheckinOpen(false);
        setCheckinStep(0);
        setCheckinError("");
      }
    }

    document.addEventListener("mousedown", handleOutsidePointerDown);
    document.addEventListener("touchstart", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
      document.removeEventListener("touchstart", handleOutsidePointerDown);
    };
  }, [checkinOpen]);

  async function submitCheckin(answers) {
    const todayKey = getTodayKey();
    const payload = {
      energy:     Number(answers.energy),
      clarity:    Number(answers.clarity),
      connection: Number(answers.connection),
    };
    if (!payload.energy || !payload.clarity || !payload.connection) {
      setCheckinError("Please complete all answers.");
      return;
    }
    setCheckinBusy(true);
    setCheckinError("");
    try {
      await submitMyDailyCheckin(todayKey, payload);
      setCheckinDone(true);
      setCheckinOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save your check-in.";
      setCheckinError(message.includes("already submitted") ? "Today's check-in is already completed." : message);
      if (message.includes("already submitted")) {
        setCheckinDone(true);
        setCheckinOpen(false);
      }
    } finally {
      setCheckinBusy(false);
    }
  }

  function setStepAnswer(questionId, value) {
    const next = { ...checkinAnswers, [questionId]: value };
    setCheckinAnswers(next);
    if (checkinStep < CHECKIN_QUESTIONS.length - 1) {
      setTimeout(() => setCheckinStep((prev) => prev + 1), 220);
    } else {
      setTimeout(() => submitCheckin(next), 220);
    }
  }

  const currentQuestion = CHECKIN_QUESTIONS[checkinStep];
  const totalQuestions = CHECKIN_QUESTIONS.length;
  const todaysEvents = useMemo(() => {
    const todayKey = getTodayKey();
    return [...events]
      .filter((event) => getEventDateKeyCandidates(event).has(todayKey))
      .sort((a, b) => {
        const aMs = parseEventDate(getEventStart(a))?.getTime() ?? 0;
        const bMs = parseEventDate(getEventStart(b))?.getTime() ?? 0;
        return aMs - bMs;
      });
  }, [events]);
  const nextEventIndex = useMemo(() => {
    if (!todaysEvents.length) return -1;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const idx = todaysEvents.findIndex((event) => {
      const start = getEventStart(event);
      if (!start) return false;
      const d = parseEventDate(start);
      if (!d) return false;
      const eventMinutes = d.getHours() * 60 + d.getMinutes();
      return eventMinutes >= nowMinutes;
    });
    return idx >= 0 ? idx : 0;
  }, [todaysEvents]);
  const nextEvent = nextEventIndex >= 0 ? todaysEvents[nextEventIndex] : null;
  const upcomingEvents = nextEventIndex >= 0
    ? todaysEvents.slice(nextEventIndex + 1, nextEventIndex + 4)
    : [];
  const hasMoreUpcomingEvents = nextEventIndex >= 0 && todaysEvents.length > nextEventIndex + 4;

  function formatHour(rawDate) {
    const dt = parseEventDate(rawDate);
    if (!dt) return "--:--";
    return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const heroTheme = (() => {
    const t = (heroContent.title || "").toLowerCase();
    if (t.includes("grow"))    return { background: "#2D3852", color: "#FFFFFF",  boxShadow: "0 18px 40px rgba(45,56,82,0.22)" };
    if (t.includes("focus"))   return { background: "#FAF3DC", color: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.10)" };
    if (t.includes("breathe")) return { background: "#1FD0EF", color: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.22)" };
    return                            { background: "#1FD0EF", color: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.22)" };
  })();
  const isHeroDark = heroTheme.background === "#2D3852";

  function getEventDotColor(eventType) {
    const type = String(eventType || "").toLowerCase();
    if (type === "talk" || type === "talks" || type === "podcast") return "#1FD0EF";
    if (type === "activity" || type === "workshop") return "#4EA72E";
    if (type === "meeting" || type === "team") return "#2D3852";
    if (type === "wellness" || type === "wellbeing" || type === "break") return "#0A859B";
    if (type === "social" || type === "meal" || type === "logistics") return "#FFB950";
    return "#B9C1D4";
  }

  return (
      <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
        <div
          className="mx-auto grid grid-cols-1 gap-[9px]"
          style={{ width: "calc(100% - 20px)", maxWidth: 370 }}
        >
        <section
          className="relative overflow-hidden rounded-[24px] px-[16px] pt-[20px] pb-[14px] sm:px-[20px] sm:pt-[24px] sm:pb-[16px]"
          style={{
            background: heroTheme.background,
            color: heroTheme.color,
            boxShadow: heroTheme.boxShadow,
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: isHeroDark ? "rgba(255,255,255,0.08)" : "rgba(45, 56, 82, 0.18)" }}
          />

          <div className="relative flex items-center justify-between">
            <span
              className="uppercase"
              style={{
                fontSize: "11px",
                letterSpacing: "0.14em",
                fontWeight: 500,
                opacity: 0.75,
              }}
            >
              {heroContent.phase_label}
            </span>
            <span
              className="uppercase rounded-full px-[10px] py-[5px]"
              style={{
                fontSize: "9.5px",
                letterSpacing: "0.14em",
                fontWeight: 600,
                background: isHeroDark ? "rgba(255,255,255,0.14)" : "rgba(45, 56, 82, 0.14)",
              }}
            >
              {heroContent.badge_text}
            </span>
          </div>

          <div className="relative mt-2">
            <h1
              style={{
                fontFamily: "Taviraj, serif",
                fontWeight: 300,
                fontSize: "clamp(30px, 8.8vw, 42px)",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                margin: 0,
                color: heroTheme.color,
              }}
            >
              {heroContent.title}
            </h1>
            <p
              style={{
                fontSize: "14px",
                fontStyle: "italic",
                marginTop: "4px",
                color: heroTheme.color,
                opacity: 0.7,
              }}
            >
              {heroContent.subtitle}
            </p>
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${isHeroDark ? "rgba(255,255,255,0.15)" : "rgba(45,56,82,0.18)"}` }}>
              <DailyPodcastCard podcast={podcastContent} dark={isHeroDark} />
            </div>
          </div>
        </section>

        <AnimatePresence>
        {todayMatch ? (
          <MatchCard match={todayMatch} onClick={() => navigate(`/person/${todayMatch.counterpart.id}`)} />
        ) : null}
        {pendingMatches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            stale
            onClick={() => navigate(`/person/${m.counterpart.id}`)}
          />
        ))}
        </AnimatePresence>

        <AnimatePresence>
        {myOneOnOnesCount > 0 ? (
          <Motion.button
            key="one-on-ones-card"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
            type="button"
            onClick={() => navigate("/one-on-ones")}
            className="w-full text-left rounded-[20px] px-[18px] pt-[16px] pb-[14px] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.25)]"
            style={{ background: "#2D3852", border: "none" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[10px]">
                <div
                  className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "#ECFAFD" }}
                >
                  <Users size={16} color="#0A859B" />
                </div>
                <div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#FFFFFF" }}>Your 1:1&apos;s</p>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>
                    {myOneOnOnesCount} meeting{myOneOnOnesCount === 1 ? "" : "s"} assigned
                  </p>
                </div>
              </div>
              <ChevronRight size={16} color="rgba(255,255,255,0.5)" />
            </div>
            {myOneOnOnesWithoutAudio > 0 ? (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF9950", flexShrink: 0, display: "inline-block" }} />
                <p style={{ fontSize: "11px", color: "#FF9950", fontWeight: 600, margin: 0 }}>
                  Feedback pending for {myOneOnOnesWithoutAudio} 1:1{myOneOnOnesWithoutAudio === 1 ? "" : "'s"}
                </p>
              </div>
            ) : null}
          </Motion.button>
        ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="wait">
        {checkinDone ? null : checkinOpen ? (
          <Motion.section
            ref={checkinOpenRef}
            key="checkin-open"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="mt-2 box-border max-w-full rounded-[20px] border px-[18px] pt-[18px] pb-[16px]"
            style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="uppercase" style={{ fontSize: "11px", letterSpacing: "0.14em", color: "#0A859B", fontWeight: 500 }}>
                  Daily check-in
                </span>
                <div className="flex-1 flex items-center gap-1">
                  {CHECKIN_QUESTIONS.map((_, i) => (
                    <span
                      key={i}
                      style={{
                        flex: 1,
                        height: "3px",
                        borderRadius: 99,
                        background: i <= checkinStep ? "#1FD0EF" : "#E2E7ED",
                        transition: "background 240ms cubic-bezier(.16,1,.3,1)",
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: "10.5px", color: "#6E7892", minWidth: 22, textAlign: "right" }}>
                  {checkinStep + 1}/{totalQuestions}
                </span>
              </div>

              <div
                style={{
                  fontFamily: "Taviraj, serif",
                  fontWeight: 300,
                  fontSize: "20px",
                  lineHeight: 1.25,
                  color: "#2D3852",
                  letterSpacing: "-0.01em",
                }}
              >
                {currentQuestion.prompt}
              </div>
              <div style={{ marginTop: "4px" }}>
                <ScaleAnswer
                  value={checkinAnswers[currentQuestion.id]}
                  onPick={(n) => setStepAnswer(currentQuestion.id, n)}
                  anchors={currentQuestion.anchors}
                />
              </div>

              {checkinError ? <p style={{ fontSize: "11px", color: "#D9534F" }}>{checkinError}</p> : null}
            </div>
          </Motion.section>
        ) : (
          <Motion.button
            key="checkin-closed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            type="button"
            onClick={() => setCheckinOpen(true)}
            className="mt-2 box-border max-w-full rounded-[20px] border px-[18px] pt-[12px] pb-[14px] text-left w-full transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
            style={{
              background: "#FFFFFF",
              borderColor: "#EEF2F5",
            }}
          >
            <div className="flex items-center gap-[14px]">
              <div
                className="h-[42px] w-[42px] shrink-0 rounded-full flex items-center justify-center"
                style={{ background: "#ECFAFD", color: "#0A859B" }}
              >
                <Leaf size={20} />
              </div>

              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span
                  className="uppercase"
                  style={{
                    fontSize: "11px",
                    letterSpacing: "0.14em",
                    fontWeight: 500,
                    color: "#0A859B",
                  }}
                >
                  Daily check-in
                </span>
                <p style={{ fontSize: "14px", fontWeight: 500, color: "#2D3852", marginTop: "2px", marginBottom: 0 }}>
                  How are you feeling today?
                </p>
              </div>

              <div
                className="h-[30px] w-[30px] shrink-0 rounded-full flex items-center justify-center"
                style={{ background: "#1FD0EF", color: "#2D3852" }}
              >
                <ArrowRight size={14} strokeWidth={2} />
              </div>
            </div>
          </Motion.button>
        )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => navigate("/schedule")}
          className="w-full text-left rounded-[20px] border px-[18px] pt-[16px] pb-[14px] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
          style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
        >
          <div className="flex items-center justify-between mb-[14px]">
            <div className="flex items-center gap-[10px]">
              <div
                className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                style={{ background: "#1FD0EF" }}
              >
                <CalendarDays size={17} color="#2D3852" />
              </div>
              <div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Today&apos;s schedule</p>
                <p style={{ fontSize: "11px", color: "#6E7892" }}>
                  {todaysEvents.length} session{todaysEvents.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <ChevronRight size={16} color="#6E7892" />
          </div>

          {nextEvent ? (
            <div
              className="rounded-[14px] px-[14px] py-[12px] mb-[8px]"
              style={{ background: "#F2F8FA", display: "flex", alignItems: "center", gap: 14 }}
            >
              <div style={{ textAlign: "right", minWidth: 42 }}>
                <p style={{ fontSize: "11px", color: "#6E7892", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
                  Next
                </p>
                <p style={{ fontSize: "15px", fontWeight: 600, color: "#2D3852" }}>{formatHour(getEventStart(nextEvent))}</p>
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "#E2E7ED" }} />
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "13.5px", color: "#2D3852", fontWeight: 500 }} className="truncate">
                  {nextEvent.title}
                </p>
                <p style={{ fontSize: "11px", color: "#6E7892", marginTop: 2 }} className="truncate">
                  {nextEvent.location || "Location TBD"}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] px-[14px] py-[12px] mb-[8px]" style={{ background: "#F2F8FA" }}>
              <p style={{ fontSize: "12px", color: "#6E7892" }}>No sessions scheduled for today.</p>
            </div>
          )}

          {upcomingEvents.length > 0 ? (
            <div className="flex flex-col gap-[8px] px-[4px] pt-[2px]">
              {upcomingEvents.map((event, idx) => (
                <div key={event.id} className="flex items-center gap-[12px]">
                  <span style={{ fontSize: "11.5px", color: "#6E7892", minWidth: 36 }}>{formatHour(getEventStart(event))}</span>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "9999px",
                      // El "tercer punto" del mini schedule va en naranja Decelera.
                      backgroundColor: idx === 2 ? "#FF9950" : getEventDotColor(event.type),
                      flex: "0 0 auto",
                    }}
                  />
                  <span className="truncate" style={{ fontSize: "12.5px", color: "#2D3852", fontWeight: 500 }}>
                    {event.title}
                  </span>
                </div>
              ))}
              {hasMoreUpcomingEvents ? (
                <div className="pt-[2px] pl-[55px]" aria-hidden="true">
                  <span style={{ color: "#6E7892", fontSize: "16px", lineHeight: 1 }}>⋮</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </button>

        <PeopleCardPreview
          people={peoplePreview}
          onClick={() => navigate("/people", { state: { todayOnly: true } })}
        />

        <SponsorsSection />

        <a
          href="https://decelera.fillout.com/zincomatch?utm_source=decelera_app"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(135deg, #3d6740 0%, #2a4a2d 100%)",
            borderRadius: 20,
            padding: "16px 18px",
            textDecoration: "none",
            marginTop: 4,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <img src="/sponsors/sponsor-1.svg" alt="Zinco AI" style={{ width: 24, height: 24, objectFit: "contain" }} />
            </div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#51ca6b", margin: 0 }}>Zinco</p>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#FFFFFF", margin: "2px 0 0" }}>Find your match.<br />Spoiler: <em>you&apos;ll like the result.</em></p>
            </div>
          </div>
          <ArrowRight size={16} color="#51ca6b" strokeWidth={2} />
        </a>
      </div>
    </div>
  );
}

function DailyPodcastCard({ podcast, dark = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(podcast?.duration || 0);
  const [loading, setLoading] = useState(false);

  const url = podcast?.url || FALLBACK_PODCAST.url;
  const title = podcast?.title || FALLBACK_PODCAST.title;

  function togglePlay() {
    if (!audioRef.current || !url) return;
    if (playing) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  }

  function handleSeek(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  }

  function formatTime(sec) {
    if (!sec || Number.isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const hasAudio = Boolean(url);

  return (
    <div>
      {hasAudio && (
        <audio
          ref={audioRef}
          src={url}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentTime(0); }}
          onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
          onWaiting={() => setLoading(true)}
          onCanPlay={() => setLoading(false)}
        />
      )}

      <p
        className="uppercase"
        style={{ fontSize: "11px", letterSpacing: "0.14em", fontWeight: 500, color: dark ? "rgba(255,255,255,0.55)" : "rgba(45,56,82,0.55)" }}
      >
        Daily podcast
      </p>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginTop: 8 }}>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!hasAudio || loading}
          style={{
            flexShrink: 0,
            width: 48,
            height: 48,
            borderRadius: "9999px",
            background: dark
              ? (hasAudio ? "#FAF3DC" : "rgba(255,255,255,0.12)")
              : (hasAudio ? "#2D3852" : "rgba(45,56,82,0.12)"),
            border: "none",
            cursor: hasAudio ? "pointer" : "default",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "all 160ms cubic-bezier(.16,1,.3,1)",
          }}
        >
          {loading ? (
            <span style={{ width: 16, height: 16, borderRadius: "9999px", border: dark ? "2px solid rgba(45,56,82,0.4)" : "2px solid rgba(250,243,220,0.4)", borderTopColor: dark ? "#2D3852" : "#FAF3DC", display: "inline-block", animation: "spin 0.8s linear infinite" }} />
          ) : playing ? (
            <Pause size={18} color={dark ? "#2D3852" : "#FAF3DC"} />
          ) : (
            <Play size={18} color={dark ? "#2D3852" : (hasAudio ? "#FAF3DC" : "#2D3852")} style={{ marginLeft: 2 }} />
          )}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: "Taviraj, serif",
              fontWeight: 300,
              fontStyle: "italic",
              fontSize: "17px",
              lineHeight: 1.3,
              color: dark ? "#FFFFFF" : "#2D3852",
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            {title || (
              <span style={{ opacity: 0.4 }}>Daily podcast coming soon</span>
            )}
          </p>

          <div
            role="slider"
            aria-label="Progress"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            onClick={handleSeek}
            style={{
              marginTop: 12,
              height: 4,
              borderRadius: 99,
              background: dark ? "rgba(255,255,255,0.2)" : "rgba(45,56,82,0.13)",
              cursor: hasAudio ? "pointer" : "default",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                height: "100%",
                width: `${progress}%`,
                borderRadius: 99,
                background: dark ? "#FAF3DC" : "#2D3852",
                transition: "width 0.25s linear",
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 6,
              fontSize: "10.5px",
              color: dark ? "rgba(255,255,255,0.45)" : "rgba(45,56,82,0.45)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function getPersonInitials(fullName) {
  const raw = String(fullName || "").trim();
  if (!raw) return "";
  return raw
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function AvatarBubble({ person, i, gradients }) {
  const [imageFailed, setImageFailed] = useState(false);
  const photoUrl = person?.photo_url;
  const initials = getPersonInitials(person?.full_name || person?.company || "");

  const showPhoto = Boolean(photoUrl) && !imageFailed;
  return (
    <div
      style={{
        position: "absolute",
        left: i * 18,
        top: 0,
        width: 36,
        height: 36,
        borderRadius: "9999px",
        background: gradients[i % gradients.length],
        color: "#FFFFFF",
        border: "2px solid #FFFFFF",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {showPhoto ? (
        <img
          src={photoUrl}
          alt={initials}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        initials
      )}
    </div>
  );
}

function PeopleCardPreview({ people, onClick }) {
  const gradients = [
    "linear-gradient(135deg, #1FD0EF, #0A859B)",
    "linear-gradient(135deg, #FF9950, #D9534F)",
    "linear-gradient(135deg, #B9C1D4, #2D3852)",
    "linear-gradient(135deg, #FAF3DC, #FF9950)",
  ];

  const todayKey = getTodayKey();
  const presentToday = Array.isArray(people)
    ? people.filter((p) => {
        if (String(p?.contact_type || "") === "team") return false;
        const arrival = dateKeyInProgramTz(p?.arrival_date);
        const departure = dateKeyInProgramTz(p?.departure_date);
        if (!arrival || !departure) return false;
        return arrival <= todayKey && departure >= todayKey;
      })
    : [];
  const preview = presentToday.slice(0, 4);
  const foundersMentorsCount = presentToday.length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-[20px] border px-[18px] pt-[16px] pb-[14px] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
      style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
    >
      <div className="flex items-center gap-[18px]">
        <div style={{ position: "relative", width: 78, height: 36 }} aria-hidden="true">
          {preview.length ? (
            preview.map((p, i) => (
              <AvatarBubble key={p?.id || i} person={p} i={i} gradients={gradients} />
            ))
          ) : (
            ["MS", "JR", "AP", "LC"].map((txt, i) => (
              <div
                key={txt}
                style={{
                  position: "absolute",
                  left: i * 18,
                  top: 0,
                  width: 36,
                  height: 36,
                  borderRadius: "9999px",
                  background: gradients[i % gradients.length],
                  color: "#FFFFFF",
                  border: "2px solid #FFFFFF",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.02em",
                }}
              >
                {txt}
              </div>
            ))
          )}
        </div>

        <div className="min-w-0 flex-1" style={{ paddingLeft: 2 }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>On site</p>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "11px",
              color: "#6E7892",
              marginTop: 2,
            }}
          >
            <MapPin size={11} color="#0A859B" style={{ transform: "translateY(-5px)" }} />
            <span style={{ transform: "translateY(-5px)" }}>
              <b style={{ color: "#2D3852", fontWeight: 600 }}>{foundersMentorsCount}</b> founders &amp; mentors today
            </span>
          </div>
        </div>

        <ChevronRight size={16} color="#6E7892" />
      </div>
    </button>
  );
}

// TODO: populate with the Decelera México 2026 sponsors (name, logo in /public/sponsors, url).
// The section is hidden while this list is empty.
const SPONSORS = [];

function SponsorLogo({ sponsor }) {
  const [failed, setFailed] = useState(false);
  const showImg = Boolean(sponsor.logo) && !failed;
  const inner = (
    <>
      {showImg ? (
        <img
          src={sponsor.logo}
          alt={sponsor.name}
          onError={() => setFailed(true)}
          style={{ maxWidth: "100%", maxHeight: 40, objectFit: "contain", display: "block" }}
        />
      ) : (
        <span style={{ fontSize: 10, color: "#B9C1D4", fontWeight: 600, textAlign: "center", letterSpacing: "0.02em" }}>
          {sponsor.name}
        </span>
      )}
    </>
  );
  const box = {
    background: "#FFFFFF",
    borderRadius: 14,
    border: "1px solid #EEF2F5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px 10px",
    minHeight: 64,
  };
  if (sponsor.url) {
    return (
      <a href={sponsor.url} target="_blank" rel="noopener noreferrer" style={{ ...box, textDecoration: "none" }}>
        {inner}
      </a>
    );
  }
  return <div style={box}>{inner}</div>;
}

function SponsorsSection() {
  if (!SPONSORS.length) return null;
  const doubled = [...SPONSORS, ...SPONSORS];
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: "#DDE4EB" }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#B9C1D4",
            whiteSpace: "nowrap",
          }}
        >
          Made possible with
        </span>
        <div style={{ flex: 1, height: 1, background: "#DDE4EB" }} />
      </div>
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            width: "max-content",
            animation: "sponsorScroll 32s linear infinite",
          }}
        >
          {doubled.map((s, i) => (
            <div key={`${s.name}-${i}`} style={{ width: 96, flexShrink: 0 }}>
              <SponsorLogo sponsor={s} />
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes sponsorScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }`}</style>
    </div>
  );
}

function ScaleAnswer({ value, onPick, anchors }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onPick(n)}
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                border: `1px solid ${active ? "#1FD0EF" : "#E2E7ED"}`,
                background: active ? "#1FD0EF" : "#fff",
                color: active ? "#2D3852" : "#4A5573",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 160ms cubic-bezier(.16,1,.3,1)",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          fontSize: 10.5,
          color: "#6E7892",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        <span>{anchors[0]}</span>
        <span>{anchors[1]}</span>
      </div>
    </div>
  );
}

function WordAnswer({ value, onSubmit, placeholder }) {
  const [v, setV] = useState(value || "");
  const ok = v.trim().length > 0 && v.trim().split(/\s+/).length <= 3;
  return (
    <div>
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && ok) onSubmit(v.trim());
        }}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#F2F8FA",
          border: "1px solid #E2E7ED",
          borderRadius: 14,
          padding: "14px 16px",
          fontFamily: "Taviraj, serif",
          fontWeight: 300,
          fontSize: 20,
          color: "#2D3852",
          letterSpacing: "-0.01em",
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={() => ok && onSubmit(v.trim())}
        disabled={!ok}
        style={{
          marginTop: 10,
          width: "100%",
          padding: "12px 16px",
          borderRadius: 999,
          border: "none",
          cursor: ok ? "pointer" : "not-allowed",
          background: ok ? "#2D3852" : "#E2E7ED",
          color: ok ? "#fff" : "#6E7892",
          fontSize: 13,
          fontWeight: 600,
          transition: "all 160ms cubic-bezier(.16,1,.3,1)",
        }}
      >
        That's the word
      </button>
    </div>
  );
}

function ReflectAnswer({ value, onSubmit, placeholder, busy }) {
  const [v, setV] = useState(value || "");
  return (
    <div>
      <textarea
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        rows={4}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "none",
          background: "#F2F8FA",
          border: "1px solid #E2E7ED",
          borderRadius: 14,
          padding: "12px 14px",
          fontSize: 13.5,
          lineHeight: 1.5,
          color: "#2D3852",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={() => onSubmit("__notebook__")}
          disabled={busy}
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 999,
            border: "1px solid #E2E7ED",
            background: "#fff",
            color: "#4A5573",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 500,
          }}
        >
          I'll write in my notebook
        </button>
        <button
          type="button"
          onClick={() => onSubmit(v.trim() || "__skipped__")}
          disabled={busy}
          style={{
            flex: 1,
            padding: "12px 14px",
            borderRadius: 999,
            border: "none",
            background: "#2D3852",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12.5,
            fontWeight: 600,
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Saving..." : "Save reflection"}
        </button>
      </div>
    </div>
  );
}
