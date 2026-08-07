import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import moment from "moment";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { useUserSchedule } from "../hooks/useUserSchedule";
import { getHomeDailyContent, listEvents } from "../api/dataService";
import { formatDayKey as eventDayKeyInTimezone } from "../lib/dateTime";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";

const BASE_HOUR_HEIGHT = 112.5;
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR = 23;
const BASE_PIXELS_PER_MINUTE = BASE_HOUR_HEIGHT / 60;
const TIME_GUTTER_WIDTH = 56;
const CALENDAR_EVENT_SIDE_PADDING = 18;

const ATTENDEE_TABS = [
  { key: "experience_maker", label: "Exp. Makers" },
  { key: "founder", label: "Founders" },
  { key: "vc", label: "VCs" },
  { key: "team", label: "Team" },
];

const CATEGORY_THEME = {
  talks_panels: { bg: "#EAFBFF", bar: "#1FD0EF", title: "#085A6A", time: "#0F7F91", label: "Talks & Panels" },
  workshops:    { bg: "#EDF9E7", bar: "#4EA72E", title: "#1D5E10", time: "#2D7A1E", label: "Workshops" },
  challenges:   { bg: "#EEF1F9", bar: "#2D3852", title: "#1A2235", time: "#3A4B6A", label: "Challenges & Investment" },
  mind_body:    { bg: "#E5F6FA", bar: "#0A859B", title: "#004D5E", time: "#0A6C80", label: "Mind, Body & Reflection" },
  networking:   { bg: "#FFF5E2", bar: "#FFB950", title: "#6B4700", time: "#8B6208", label: "Networking & Community" },
  default:      { bg: "hsl(var(--secondary))", bar: "#888780", title: "hsl(var(--foreground))", time: "#7A7A74", label: "Otros" },
};

function getCategoryFromType(type) {
  const t = String(type || "").toLowerCase().trim();
  if (t === "talk" || t === "talks" || t === "podcast") return "talks_panels";
  if (t === "activity" || t === "workshop") return "workshops";
  if (t === "meeting" || t === "team") return "challenges";
  if (t === "wellness" || t === "wellbeing" || t === "break") return "mind_body";
  if (t === "social" || t === "meal" || t === "meals" || t === "food" || t === "logistics") return "networking";
  return "default";
}

function getThemeByType(type) {
  return CATEGORY_THEME[getCategoryFromType(type)] || CATEGORY_THEME.default;
}

function formatDayPickerLabel(day) {
  const today = moment().startOf("day");
  if (day.isSame(today, "day")) return "Today";
  if (day.isSame(today.clone().add(1, "day"), "day")) return "Tomorrow";
  return day.format("ddd, MMM D");
}

function buildPositionedEvents(dayEvents) {
  if (!dayEvents.length) return [];

  const withTimes = dayEvents.map((event) => ({
    event,
    startMs: moment(event.start_time).valueOf(),
    endMs: moment(event.end_time).valueOf(),
  }));

  const groups = [];
  let currentGroup = [];
  let currentGroupEnd = 0;

  withTimes.forEach((item) => {
    if (!currentGroup.length) {
      currentGroup = [item];
      currentGroupEnd = item.endMs;
      return;
    }
    if (item.startMs < currentGroupEnd) {
      currentGroup.push(item);
      currentGroupEnd = Math.max(currentGroupEnd, item.endMs);
      return;
    }
    groups.push(currentGroup);
    currentGroup = [item];
    currentGroupEnd = item.endMs;
  });
  if (currentGroup.length) groups.push(currentGroup);

  return groups.flatMap((group) => {
    const active = [];
    const entries = [];
    let maxColumns = 1;

    group.forEach((item) => {
      for (let i = active.length - 1; i >= 0; i -= 1) {
        if (active[i].endMs <= item.startMs) active.splice(i, 1);
      }
      const usedColumns = new Set(active.map((a) => a.column));
      let column = 0;
      while (usedColumns.has(column)) column += 1;
      const placed = { ...item, column };
      active.push(placed);
      entries.push(placed);
      maxColumns = Math.max(maxColumns, active.length);
    });

    return entries.map((entry) => ({
      ...entry.event,
      column: entry.column,
      columns: maxColumns,
    }));
  });
}

export default function Schedule() {
  const { events, user, loading } = useUserSchedule();
  const location = useLocation();
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(moment().startOf("day"));
  const [masterEvents, setMasterEvents] = useState([]);
  const [currentTime, setCurrentTime] = useState(() => moment());
  const [scheduleHeaderTitle, setScheduleHeaderTitle] = useState("Schedule");
  const [attendeeFilter, setAttendeeFilter] = useState("experience_maker");
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const dayPickerRef = useRef(null);

  function openEventModal(eventId) {
    const nextSearch = new URLSearchParams(location.search);
    nextSearch.set("event", eventId);
    navigate(`${location.pathname}?${nextSearch.toString()}`);
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(moment());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!dayPickerOpen) return;
    function handleClickOutside(event) {
      if (dayPickerRef.current && !dayPickerRef.current.contains(event.target)) {
        setDayPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dayPickerOpen]);

  useEffect(() => {
    let cancelled = false;

    async function fetchMasterEvents() {
      if (!user?.id) return;
      for (let i = 0; i < 8; i += 1) {
        try {
          const data = await listEvents();
          if (cancelled) return;
          if (Array.isArray(data) && data.length > 0) {
            setMasterEvents(data);
            return;
          }
        } catch {
          // Keep retrying below to absorb transient auth/backend hiccups.
        }
        if (i < 7) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      // Keep existing master events if refresh attempts fail.
    }

    fetchMasterEvents();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const safeEvents = useMemo(() => {
    const fallback = events ?? [];
    return masterEvents.length > 0 ? masterEvents : fallback;
  }, [masterEvents, events]);

  const bootcampDays = useMemo(() => {
    const dayKeys = new Set(
      safeEvents
        .map((event) => eventDayKeyInTimezone(event.start_time))
        .filter(Boolean),
    );
    if (dayKeys.size === 0) return [moment().startOf("day")];
    return Array.from(dayKeys)
      .sort((a, b) => moment(a).diff(moment(b)))
      .map((day) => moment(day));
  }, [safeEvents]);

  const selectedDayKey = selectedDate.clone().startOf("day").format("YYYY-MM-DD");
  const selectedDayIsAvailable = bootcampDays.some((day) => day.format("YYYY-MM-DD") === selectedDayKey);
  const activeDay = useMemo(() => {
    if (selectedDayIsAvailable) {
      const existing = bootcampDays.find((day) => day.format("YYYY-MM-DD") === selectedDayKey);
      if (existing) return existing.clone();
    }
    const today = moment().startOf("day");
    return (bootcampDays.find((day) => day.isSame(today, "day")) || bootcampDays[0]).clone();
  }, [bootcampDays, selectedDayIsAvailable, selectedDayKey]);

  const activeDayKeyForHome = activeDay.format("YYYY-MM-DD");

  useEffect(() => {
    let cancelled = false;

    async function loadHeaderTitle() {
      try {
        const homeData = await getHomeDailyContent(activeDayKeyForHome);
        if (cancelled) return;
        setScheduleHeaderTitle(homeData?.title || "Schedule");
      } catch {
        if (cancelled) return;
        setScheduleHeaderTitle("Schedule");
      }
    }

    loadHeaderTitle();
    return () => {
      cancelled = true;
    };
  }, [activeDayKeyForHome]);

  const headerTheme = (() => {
    const t = scheduleHeaderTitle.toLowerCase();
    if (t.includes("grow"))    return { background: "#2D3852", textColor: "#FFFFFF",  boxShadow: "0 18px 40px rgba(45,56,82,0.22)" };
    if (t.includes("focus"))   return { background: "#FAF3DC", textColor: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.10)" };
    if (t.includes("breathe")) return { background: "#1FD0EF", textColor: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.22)" };
    return                            { background: "#FAF3DC", textColor: "#2D3852",  boxShadow: "0 18px 40px rgba(31,208,239,0.10)" };
  })();

  const isTeamUser = user?.contact_type === "team";

  const dayEvents = useMemo(() => {
    const activeDayKey = activeDay.format("YYYY-MM-DD");
    return safeEvents
      .filter((e) => {
        if (eventDayKeyInTimezone(e.start_time) !== activeDayKey) return false;
        if (!isTeamUser) return true;
        const types = e.visible_to_contact_types;
        if (!types || (Array.isArray(types) && types.length === 0)) return true;
        return Array.isArray(types) && types.includes(attendeeFilter);
      })
      .sort((a, b) => moment(a.start_time).diff(moment(b.start_time)));
  }, [safeEvents, activeDay, isTeamUser, attendeeFilter]);

  const legendItems = useMemo(() => {
    const unique = new Map();
    dayEvents.forEach((event) => {
      const category = getCategoryFromType(event.type);
      if (category === "default") return;
      const theme = getThemeByType(event.type);
      const key = `${theme.label}-${theme.bar}`;
      if (!unique.has(key)) unique.set(key, { label: theme.label, color: theme.bar });
    });
    return Array.from(unique.values());
  }, [dayEvents]);

  const calendarRange = useMemo(() => {
    if (!dayEvents.length) return { startHour: CALENDAR_START_HOUR, endHour: CALENDAR_END_HOUR };
    const startHour = Math.max(
      0,
      Math.min(
        CALENDAR_START_HOUR,
        ...dayEvents.map((event) => moment(event.start_time).startOf("hour").hour()),
      ),
    );
    const endHour = Math.min(
      24,
      Math.max(
        CALENDAR_END_HOUR,
        ...dayEvents.map((event) => {
          const end = moment(event.end_time);
          return end.minute() > 0 || end.second() > 0 ? end.hour() + 1 : end.hour();
        }),
      ),
    );
    return { startHour, endHour: Math.max(endHour, startHour + 1) };
  }, [dayEvents]);

  const hourRows = useMemo(
    () =>
      Array.from(
        { length: calendarRange.endHour - calendarRange.startHour + 1 },
        (_, idx) => calendarRange.startHour + idx,
      ),
    [calendarRange],
  );

  const timelineHours = useMemo(
    () => hourRows.filter((hour) => hour !== calendarRange.endHour),
    [hourRows, calendarRange.endHour],
  );

  const EVENT_GAP_PX = 4;
  const MIN_EVENT_HEIGHT_PX = 12;
  // Base spacing between hour lines is controlled directly by BASE_HOUR_HEIGHT.
  // Event cards can still be pushed down when needed to keep visual separation.
  const pixelsPerMinute = BASE_PIXELS_PER_MINUTE;

  const rowMetrics = useMemo(() => {
    const byHour = new Map();
    timelineHours.forEach((hour, index) => {
      byHour.set(hour, { rowHeight: 60 * pixelsPerMinute, top: index * 60 * pixelsPerMinute });
    });
    return { byHour, totalHeight: timelineHours.length * 60 * pixelsPerMinute };
  }, [timelineHours, pixelsPerMinute]);

  function getYForTimePoint(timePoint) {
    const minutesFromStart =
      (timePoint.hour() - calendarRange.startHour) * 60 + timePoint.minute() + timePoint.second() / 60;
    return Math.max(0, minutesFromStart * pixelsPerMinute);
  }

  function getEventGeometry(event) {
    const start = moment(event.start_time);
    const end = moment(event.end_time);
    const top = getYForTimePoint(start);
    const durationMinutes = Math.max(1, end.diff(start, "minutes", true));
    const height = durationMinutes * pixelsPerMinute;

    return {
      top: top + EVENT_GAP_PX / 2,
      height: Math.max(MIN_EVENT_HEIGHT_PX, height - EVENT_GAP_PX),
    };
  }

  const positionedEvents = useMemo(() => buildPositionedEvents(dayEvents), [dayEvents]);
  const eventGeometryById = useMemo(() => {
    const byColumn = new Map();
    positionedEvents.forEach((event) => {
      if (!byColumn.has(event.column)) byColumn.set(event.column, []);
      byColumn.get(event.column).push(event);
    });

    const geometries = new Map();
    byColumn.forEach((columnEvents) => {
      const sorted = [...columnEvents].sort((a, b) => moment(a.start_time).diff(moment(b.start_time)));
      let previousBottom = -Infinity;

      sorted.forEach((event) => {
        const start = moment(event.start_time);
        const end = moment(event.end_time);
        const naturalTop = getYForTimePoint(start) + EVENT_GAP_PX / 2;
        const durationMinutes = Math.max(1, end.diff(start, "minutes", true));
        const naturalHeight = Math.max(MIN_EVENT_HEIGHT_PX, durationMinutes * pixelsPerMinute - EVENT_GAP_PX);
        const top = Math.max(naturalTop, previousBottom + EVENT_GAP_PX);

        geometries.set(event.id, { top, height: naturalHeight });
        previousBottom = top + naturalHeight;
      });
    });

    return geometries;
  }, [positionedEvents, pixelsPerMinute, calendarRange.startHour]);
  const calendarContentHeight = useMemo(() => {
    let maxEventBottom = 0;
    eventGeometryById.forEach((geom) => {
      maxEventBottom = Math.max(maxEventBottom, geom.top + geom.height);
    });
    return Math.max(rowMetrics.totalHeight, maxEventBottom + EVENT_GAP_PX);
  }, [eventGeometryById, rowMetrics.totalHeight]);
  const calendarHeight = (calendarRange.endHour - calendarRange.startHour) * 60 * pixelsPerMinute;
  const TOP_INSET_PX = 14;
  const BOTTOM_INSET_PX = 20; // más fondo blanco abajo
  const EVENT_CARD_START_OFFSET_PX = 7; // Alinea el borde superior con la línea horaria (centrado interno)
  const calendarBodyHeight = calendarHeight + TOP_INSET_PX + BOTTOM_INSET_PX;
  const nowMinutesFromDay = currentTime.hours() * 60 + currentTime.minutes();
  const calendarStartMinutes = calendarRange.startHour * 60;
  const calendarEndMinutes = calendarRange.endHour * 60;
  const nowLineVisible =
    nowMinutesFromDay >= calendarStartMinutes &&
    nowMinutesFromDay <= calendarEndMinutes &&
    currentTime.isSame(activeDay, "day");
  const nowLineTop = (nowMinutesFromDay - calendarStartMinutes) * pixelsPerMinute;

  const activeDayIndex = useMemo(
    () => bootcampDays.findIndex((day) => day.isSame(activeDay, "day")),
    [bootcampDays, activeDay],
  );

  const canGoPrevDay = activeDayIndex > 0;
  const canGoNextDay = activeDayIndex >= 0 && activeDayIndex < bootcampDays.length - 1;

  function goToPrevDay() {
    if (!canGoPrevDay) return;
    setDayPickerOpen(false);
    setSelectedDate(bootcampDays[activeDayIndex - 1].clone());
  }

  function goToNextDay() {
    if (!canGoNextDay) return;
    setDayPickerOpen(false);
    setSelectedDate(bootcampDays[activeDayIndex + 1].clone());
  }

  function goToToday() {
    setDayPickerOpen(false);
    setSelectedDate(moment().startOf("day"));
  }

  function selectScheduleDay(day) {
    setSelectedDate(day.clone().startOf("day"));
    setDayPickerOpen(false);
  }

  if (!loading && !user) return <UserNotRegisteredError />;

  if (loading) {
    return <LoadingState message="Preparing your day" />;
  }

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 22,
            background: headerTheme.background,
            color: headerTheme.textColor,
            boxShadow: headerTheme.boxShadow,
            marginBottom: 18,
            fontFamily: "Fustat, sans-serif",
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4">
            <div>
              <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: headerTheme.textColor, margin: 0 }}>
                {scheduleHeaderTitle}
              </h1>
              <p
                style={{
                  fontSize: 12,
                  fontFamily: "Fustat, sans-serif",
                  color: headerTheme.textColor === "#FFFFFF" ? "rgba(255,255,255,0.75)" : "#6E7892",
                  marginTop: 2,
                }}
              >
                Calendar view of the day
              </p>
            </div>

            <Link
              to={`/schedule/feedback/${activeDay.format("YYYY-MM-DD")}`}
              className="app-card-interactive"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 20,
                padding: "14px 16px",
                border: "1.5px solid #EEF2F5",
                backgroundColor: "#2D3852",
                color: "#FFFFFF",
                fontSize: 11,
                fontWeight: 800,
                fontFamily: "Fustat, sans-serif",
                letterSpacing: "0.02em",
                lineHeight: 1.1,
                whiteSpace: "nowrap",
                minHeight: 44,
              }}
            >
              Send us your feedback
            </Link>
          </Motion.div>

        </div>

        <div className="mt-4 mb-2">
          <h2 style={{ fontFamily: "Taviraj, serif", fontWeight: 600, fontSize: 18, color: "#2D3852" }}>
            {activeDay.format("dddd, MMMM D")}
          </h2>
        </div>

        <div
          className="schedule-day-nav-bar"
          style={{
            border: "none",
            background: "transparent",
            padding: 0,
            marginBottom: 14,
            borderRadius: 0,
          }}
        >
          <div className="schedule-day-nav-main">
            <button
              type="button"
              onClick={goToPrevDay}
              disabled={!canGoPrevDay}
              className="schedule-day-nav-btn"
              aria-label="Previous day"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div ref={dayPickerRef} className="schedule-day-picker-wrap schedule-day-picker-wrap-center">
              <button
                type="button"
                className={`schedule-day-current-btn schedule-day-current-btn-menu${dayPickerOpen ? " schedule-day-current-btn-menu-open" : ""}`}
                onClick={() => setDayPickerOpen((open) => !open)}
                aria-expanded={dayPickerOpen}
                aria-haspopup="listbox"
                aria-label={`Selected day ${activeDay.format("MMMM D")}. Choose another day`}
              >
                {activeDay.format("MMMM D")}
                <ChevronDown className={`schedule-day-picker-chevron${dayPickerOpen ? " schedule-day-picker-chevron-open" : ""}`} aria-hidden="true" />
              </button>
              <AnimatePresence>
                {dayPickerOpen && (
                  <Motion.div
                    role="listbox"
                    aria-label="Days with schedule"
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                    className="schedule-day-picker-menu schedule-day-picker-menu-center"
                  >
                    {bootcampDays.map((day) => {
                      const isActive = day.isSame(activeDay, "day");
                      return (
                        <button
                          key={day.format("YYYY-MM-DD")}
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => selectScheduleDay(day)}
                          className={`schedule-day-picker-item${isActive ? " schedule-day-picker-item-active" : ""}`}
                        >
                          <span className="schedule-day-picker-item-label">{formatDayPickerLabel(day)}</span>
                        </button>
                      );
                    })}
                  </Motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={goToNextDay}
              disabled={!canGoNextDay}
              className="schedule-day-nav-btn"
              aria-label="Next day"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="schedule-today-btn"
          >
            Today
          </button>
        </div>

        {isTeamUser && (
          <div className="people-filter-tabs flex overflow-x-auto pb-3 pl-4">
            {ATTENDEE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setAttendeeFilter(tab.key)}
                className={`flex-shrink-0 rounded-full font-semibold transition-all ${
                  attendeeFilter === tab.key
                    ? "text-white"
                    : "app-card text-muted-foreground"
                }`}
                style={
                  attendeeFilter === tab.key
                    ? { background: "#2D3852", color: "#FFFFFF", marginRight: 6, padding: "6px 13px", fontSize: 11.5 }
                    : { marginRight: 6, padding: "6px 13px", fontSize: 11.5 }
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <Motion.div
          key={activeDay.format("YYYY-MM-DD")}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="rounded-[20px] border overflow-hidden"
          style={{ background: "#FFFFFF", borderColor: "#D6D9D7", boxShadow: "0 6px 18px rgba(45,56,82,0.06)" }}
        >
          <div
            className="border-b grid grid-cols-2"
            style={{
              borderColor: "hsl(var(--border) / 0.7)",
              paddingLeft: 36,
              paddingRight: 16,
              paddingTop: 14,
              paddingBottom: 14,
              columnGap: 2,
              rowGap: 6,
            }}
          >
            {(legendItems.length ? legendItems : [
              { label: CATEGORY_THEME.talks_panels.label, color: CATEGORY_THEME.talks_panels.bar },
              { label: CATEGORY_THEME.workshops.label, color: CATEGORY_THEME.workshops.bar },
              { label: CATEGORY_THEME.challenges.label, color: CATEGORY_THEME.challenges.bar },
              { label: CATEGORY_THEME.mind_body.label, color: CATEGORY_THEME.mind_body.bar },
              { label: CATEGORY_THEME.networking.label, color: CATEGORY_THEME.networking.bar },
            ]).map((item) => (
              <div key={item.label} className="inline-flex items-center min-w-0" style={{ gap: 8 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "9999px", backgroundColor: item.color }} />
                <span
                  style={{ color: "hsl(var(--muted-foreground))", fontSize: 12.5, lineHeight: 1.3, fontFamily: "Fustat, sans-serif" }}
                >
                  {item.label}
                </span>
              </div>
            ))}
          </div>

          <div className="relative" style={{ height: `${calendarContentHeight}px` }}>
            <div className="absolute inset-0">
              {timelineHours.map((hour) => {
                const metric = rowMetrics.byHour.get(hour);
                if (!metric) return null;
                return (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-b"
                    style={{ top: metric.top, height: metric.rowHeight, borderColor: "hsl(var(--border) / 0.45)" }}
                  >
                    <div
                      className="absolute top-[10px] w-[52px] pr-2 text-right text-[11px] font-medium"
                      style={{ left: -14, color: "hsl(var(--muted-foreground))" }}
                    >
                      {`${hour}:00`}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="absolute" style={{ left: 52, right: 10, top: 0, bottom: 0 }}>
              {positionedEvents.map((event) => {
                const theme = getThemeByType(event.type);
                const geom = eventGeometryById.get(event.id) || getEventGeometry(event);
                const columnWidth = 100 / event.columns;
                const left = (event.column / event.columns) * 100;
                const gapPx = event.columns > 1 ? 4 : 0;
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => openEventModal(event.id)}
                    className="absolute flex items-center gap-[8px] rounded-[4px] px-3 py-2 border-0 outline-none appearance-none text-left"
                    style={{
                      background: theme.bg,
                      top: geom.top,
                      left: `calc(${left}% + ${gapPx}px)`,
                      width: `calc(${columnWidth}% - ${gapPx + 2}px)`,
                      height: geom.height,
                      transition: "transform 150ms ease, box-shadow 150ms ease, filter 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(45,56,82,0.15)";
                      e.currentTarget.style.filter = "brightness(0.96)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = "";
                      e.currentTarget.style.boxShadow = "";
                      e.currentTarget.style.filter = "";
                    }}
                  >
                    <div className="w-[3px] self-stretch rounded-[2px] flex-shrink-0" style={{ background: theme.bar }} />
                    <span className="flex-1 text-[13px] font-medium truncate" style={{ color: theme.title }}>
                      {event.title}
                    </span>
                    <span
                      className="text-[11px] text-right whitespace-nowrap flex-shrink-0"
                      style={{
                        color: theme.title,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {moment(event.start_time).format("H:mm")} - {moment(event.end_time).format("H:mm")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

        </Motion.div>
      </div>
    </div>
  );
}

