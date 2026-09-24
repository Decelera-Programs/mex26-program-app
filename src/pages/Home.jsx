import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentUser, getHomeDailyContent, getMyMatches, listEvents, listMyOneOnOnes, listPeople } from "../api/dataService";
import MatchCard from "../components/MatchCard";
import MatchIntroModal from "../components/MatchIntroModal";
import AttentionWrap from "../components/AttentionWrap";
import { CalendarDays, ChevronRight, MapPin, Users } from "lucide-react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PROGRAM_TIMEZONE, daysSinceProgramStart, getTodayKey, programNow } from "../lib/dateTime";
import { DUR, SPRING_GENTLE } from "../lib/motion";
import { isMatchOpened } from "../lib/matchFlags";
import DeceleraRosetteMark from "../components/DeceleraRosetteMark";

const FALLBACK_HERO_CONTENT = {
  phase_label: "",
  badge_text: `TODAY · ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", timeZone: PROGRAM_TIMEZONE }).format(new Date())}`,
  title: "Decelera\nMéxico 2026",
  subtitle: (() => {
    const diff = -daysSinceProgramStart(getTodayKey());
    return diff > 0 ? `${diff} days until the program` : "Welcome to the program.";
  })(),
  body_text: "Slow down before you scale. We start the week soft - long walks, no laptops before lunch, dinners that run late.",
  reflection_text: "What would today look like if you trusted the week to do its work?",
};

function dateKeyInProgramTz(raw) {
  if (!raw) return null;
  const str = String(raw).trim().replace(" ", "T");
  const withTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(str) ? str : `${str}Z`;
  const d = new Date(withTz);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: PROGRAM_TIMEZONE }).format(d);
}

const ONE_ON_ONE_VISIT_KEY = "decelera.oneonones.visited";
function oneOnOnesVisitedOn(dayKey) {
  try {
    return localStorage.getItem(ONE_ON_ONE_VISIT_KEY) === dayKey;
  } catch {
    return false;
  }
}
function markOneOnOnesVisited(dayKey) {
  try {
    localStorage.setItem(ONE_ON_ONE_VISIT_KEY, dayKey);
  } catch {
    /* ignore */
  }
}

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
  const [events, setEvents] = useState([]);
  const [peoplePreview, setPeoplePreview] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [myOneOnOnesCount, setMyOneOnOnesCount] = useState(0);
  const [todayMatch, setTodayMatch] = useState(null);
  const [pendingMatches, setPendingMatches] = useState([]);
  // The match + 1:1 cards depend on a fetch; hold their slots with a skeleton
  // until it resolves so the rest of the page doesn't jump when they mount.
  const [homeLoading, setHomeLoading] = useState(true);
  const [engagedMatchIds, setEngagedMatchIds] = useState(() => new Set());
  const [oneOnOneVisitedToday, setOneOnOneVisitedToday] = useState(() => oneOnOnesVisitedOn(getTodayKey()));
  const [highlightMatchId, setHighlightMatchId] = useState(null);
  const matchAnchorRef = useRef(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const markMatchEngaged = (id) => {
    setEngagedMatchIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };
  const [myOneOnOnesWithoutAudio, setMyOneOnOnesWithoutAudio] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const todayKey = getTodayKey();

    async function loadHomeData() {
      try {
        const [homeData, peopleData, oneOnOnesData, userData, matchData] = await Promise.all([
          getHomeDailyContent(todayKey).catch(() => null),
          listPeople().catch(() => []),
          listMyOneOnOnes().catch(() => []),
          getCurrentUser().catch(() => null),
          getMyMatches().catch(() => ({ today: null, pending: [] })),
        ]);
        if (cancelled) return;
        if (userData) setCurrentUser(userData);
        const nextToday = matchData?.today || null;
        const nextPending = Array.isArray(matchData?.pending) ? matchData.pending : [];
        setTodayMatch(nextToday);
        setPendingMatches(nextPending);
        const seededEngaged = new Set();
        for (const m of [nextToday, ...nextPending]) {
          if (m?.id && (m.my_feedback || isMatchOpened(m.id))) seededEngaged.add(m.id);
        }
        setEngagedMatchIds(seededEngaged);

        if (homeData) {
          setHeroContent({
            phase_label: homeData.phase_label || FALLBACK_HERO_CONTENT.phase_label,
            badge_text: homeData.badge_text || FALLBACK_HERO_CONTENT.badge_text,
            title: homeData.title || FALLBACK_HERO_CONTENT.title,
            subtitle: homeData.subtitle || FALLBACK_HERO_CONTENT.subtitle,
            body_text: homeData.body_text || FALLBACK_HERO_CONTENT.body_text,
            reflection_text: homeData.reflection_text || FALLBACK_HERO_CONTENT.reflection_text,
          });
        }
        if (Array.isArray(peopleData) && peopleData.length) {
          setPeoplePreview(peopleData);
        }
        const oneOnOnes = Array.isArray(oneOnOnesData) ? oneOnOnesData : [];
        setMyOneOnOnesCount(oneOnOnes.length);
        setHomeLoading(false);

        if (oneOnOnes.length > 0 && userData?.contact_type === "experience_maker") {
          setMyOneOnOnesWithoutAudio(oneOnOnes.filter((oo) => !oo.has_active_audio).length);
        }
      } catch {
        if (!cancelled) setHeroContent(FALLBACK_HERO_CONTENT);
      } finally {
        if (!cancelled) setHomeLoading(false);
      }
    }

    // Retry only on an error (transient auth/session timing), once. An empty
    // list is a real answer, not a reason to wait.
    async function loadEventsWithRetry() {
      for (let i = 0; i < 2; i += 1) {
        try {
          const data = await listEvents();
          if (!cancelled) setEvents(Array.isArray(data) ? data : []);
          return;
        } catch {
          if (i === 0) await new Promise((resolve) => setTimeout(resolve, 600));
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

  // Arrived from a match notification (?match=<id>): remember which card to
  // reveal, then drop the param so a refresh doesn't re-trigger. Reading a URL
  // param into state once on arrival is a legitimate effect use here. The intro
  // modal below still gates itself to once/match/day, so this lands the same as
  // an organic first open of the day — modal first, then the card underneath.
  useEffect(() => {
    const wanted = searchParams.get("match");
    if (!wanted) return;
    setHighlightMatchId(wanted);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("match");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Once the highlighted match card is actually in the DOM, scroll it into view.
  useEffect(() => {
    if (!highlightMatchId) return undefined;
    const present =
      todayMatch?.id === highlightMatchId || pendingMatches.some((m) => m.id === highlightMatchId);
    if (!present) return undefined;
    const t = setTimeout(() => {
      matchAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 220);
    return () => clearTimeout(t);
  }, [highlightMatchId, todayMatch, pendingMatches]);

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
    // Event times are naive Mexico wall clock, so "now" must be too.
    const now = programNow();
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
          className="relative overflow-hidden rounded-[24px] px-[16px] pt-[20px] pb-[20px] sm:px-[20px] sm:pt-[24px] sm:pb-[24px]"
          style={{
            background: heroTheme.background,
            color: heroTheme.color,
            boxShadow: heroTheme.boxShadow,
          }}
        >
          <div
            className="decelera-mx-mark pointer-events-none absolute"
            style={{ right: -56, bottom: -56, height: 210, width: 210, color: heroTheme.color }}
          >
            <DeceleraRosetteMark />
          </div>

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
              {String(heroContent.title || "").split("\n").map((line, i) => (
                <span key={i} style={{ display: "block" }}>{line}</span>
              ))}
            </h1>
            <p
              style={{
                fontSize: "14px",
                fontStyle: "italic",
                margin: "4px 0 0",
                color: heroTheme.color,
                opacity: 0.7,
              }}
            >
              {heroContent.subtitle}
            </p>
          </div>
        </section>

        <div ref={matchAnchorRef} style={{ scrollMarginTop: 16 }} />
        {todayMatch ? (
          <MatchIntroModal
            match={todayMatch}
            onSeeDetails={() => {
              setHighlightMatchId(todayMatch.id);
              matchAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          />
        ) : null}
        <AnimatePresence>
        {!homeLoading && todayMatch ? (
          <GrowIn key={`grow-${todayMatch.id}`}>
            <AttentionWrap pulse={!engagedMatchIds.has(todayMatch.id)}>
              <MatchCard
                match={todayMatch}
                highlight={highlightMatchId === todayMatch.id}
                onEngaged={markMatchEngaged}
                onClick={() => navigate(`/person/${todayMatch.counterpart.id}`)}
              />
            </AttentionWrap>
          </GrowIn>
        ) : null}
        {!homeLoading && pendingMatches.map((m) => (
          <GrowIn key={`grow-${m.id}`}>
            <AttentionWrap pulse={!engagedMatchIds.has(m.id) && !m.my_feedback}>
              <MatchCard
                match={m}
                stale
                highlight={highlightMatchId === m.id}
                onEngaged={markMatchEngaged}
                onClick={() => navigate(`/person/${m.counterpart.id}`)}
              />
            </AttentionWrap>
          </GrowIn>
        ))}
        </AnimatePresence>

        <AnimatePresence>
        {!homeLoading && myOneOnOnesCount > 0 ? (
          <GrowIn key="one-on-ones-grow">
          <AttentionWrap
            pulse={myOneOnOnesWithoutAudio > 0 && !oneOnOneVisitedToday}
          >
          <button
            type="button"
            onClick={() => {
              const dayKey = getTodayKey();
              markOneOnOnesVisited(dayKey);
              setOneOnOneVisitedToday(true);
              navigate("/one-on-ones");
            }}
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
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>Your 1:1&apos;s</p>
                  <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)", margin: 0 }}>
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
          </button>
          </AttentionWrap>
          </GrowIn>
        ) : null}
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
                style={{ background: "#ECFAFD" }}
              >
                <CalendarDays size={17} color="#0A859B" />
              </div>
              <div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852", margin: 0 }}>Today&apos;s schedule</p>
                <p style={{ fontSize: "11px", color: "#6E7892", margin: 0 }}>
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
                <p style={{ fontSize: "11px", color: "#6E7892", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, margin: 0 }}>
                  Next
                </p>
                <p style={{ fontSize: "15px", fontWeight: 600, color: "#2D3852", margin: 0 }}>{formatHour(getEventStart(nextEvent))}</p>
              </div>
              <div style={{ width: 1, alignSelf: "stretch", background: "#E2E7ED" }} />
              <div className="min-w-0 flex-1">
                <p style={{ fontSize: "13.5px", color: "#2D3852", fontWeight: 500, margin: 0 }} className="truncate">
                  {nextEvent.title}
                </p>
                <p style={{ fontSize: "11px", color: "#6E7892", margin: "2px 0 0" }} className="truncate">
                  {nextEvent.location || "Location TBD"}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] px-[14px] py-[12px] mb-[8px]" style={{ background: "#F2F8FA" }}>
              <p style={{ fontSize: "12px", color: "#6E7892", margin: 0 }}>No sessions scheduled for today.</p>
            </div>
          )}

          {upcomingEvents.length > 0 ? (
            <div className="flex flex-col gap-[8px] px-[4px] pt-[2px]">
              {upcomingEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-[12px]">
                  <span style={{ fontSize: "11.5px", color: "#6E7892", minWidth: 36 }}>{formatHour(getEventStart(event))}</span>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "9999px",
                      backgroundColor: getEventDotColor(event.type),
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
      </div>
    </div>
  );
}

// Data-dependent Home cards (today's match, the 1:1 card) can only mount once
// their fetch resolves. Instead of snapping into the layout and shoving the page
// down, they grow open from zero height + fade over ~0.4s, so the push is gentle.
// overflow is released after the animation so the card's own glow/shadow (the
// "needs attention" pulse) isn't clipped.
function GrowIn({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <Motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{
        height: SPRING_GENTLE,
        opacity: { duration: DUR.expand * 0.7, delay: DUR.expand * 0.12, ease: "linear" },
      }}
      onAnimationComplete={() => setOpen(true)}
      style={{ overflow: open ? "visible" : "hidden" }}
    >
      {children}
    </Motion.div>
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

function AvatarBubble({ person, i }) {
  const [imageFailed, setImageFailed] = useState(false);
  const photoUrl = person?.photo_url;
  const initials = getPersonInitials(person?.full_name || person?.company || "");

  const showPhoto = Boolean(photoUrl) && !imageFailed;
  return (
    <div
      style={{
        position: "absolute",
        left: i * 14,
        top: 0,
        width: 36,
        height: 36,
        borderRadius: "9999px",
        background: "#EEF2F5",
        color: "#2D3852",
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
  // The stack is 4 overlapping 36px circles offset 18px each; size the
  // container to however many are actually shown so a single avatar doesn't
  // leave a dead gap before the text (was a fixed 78px, sized for exactly 4).
  const avatarStackWidth = 36 + (Math.max(preview.length, 1) - 1) * 14;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-[20px] border px-[18px] pt-[16px] pb-[14px] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
      style={{ background: "#FFFFFF", borderColor: "#EEF2F5", boxShadow: "0 4px 14px rgba(45,56,82,0.06)" }}
    >
      <div className="flex items-center gap-[18px]">
        <div style={{ position: "relative", width: preview.length ? avatarStackWidth : 78, height: 36 }} aria-hidden="true">
          {preview.length ? (
            preview.map((p, i) => (
              <AvatarBubble key={p?.id || i} person={p} i={i} />
            ))
          ) : (
            ["MS", "JR", "AP", "LC"].map((txt, i) => (
              <div
                key={txt}
                style={{
                  position: "absolute",
                  left: i * 14,
                  top: 0,
                  width: 36,
                  height: 36,
                  borderRadius: "9999px",
                  background: "#EEF2F5",
                  color: "#2D3852",
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
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852", margin: 0 }}>On site</p>
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
            <MapPin size={11} color="#0A859B" />
            <span>
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
