import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router-dom";
import { Check, ChevronRight, Clock, MapPin, Mic, PenLine, Square, Upload, Users } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  getCurrentUser,
  getOneOnOneAudio,
  listMyOneOnOnes,
  registerOneOnOneAudioSubmission,
  submitOneOnOneTeamKpis,
  uploadOneOnOneAudioToStorage,
} from "../api/dataService";
import {
  formatDayKey,
  formatDayLabel,
  formatShortDateTime,
  formatTime24,
  getTodayKey,
  programNow,
} from "../lib/dateTime";
import LoadingState from "../components/LoadingState";
import DeceleraRosetteMark from "../components/DeceleraRosetteMark";
import AudioPlayer from "../components/AudioPlayer";
import EmptyState from "../components/EmptyState";
import UserNotRegisteredError from "./UserNotRegisteredError";
import { SPRING, stagger } from "../lib/motion";

const TEAM_KPIS = [
  { key: "trust_conflict_resolution", label: "Trust & Conflict Resolution" },
  { key: "clear_operational_roles", label: "Clear Operational Roles" },
  { key: "complementary_personality", label: "Complementary Personality" },
  { key: "vision_alignment", label: "Vision Alignment" },
];

// Sliders need a starting position — default at the midpoint rather than
// leaving the field ambiguous between "unanswered" and "rated a 5".
const DEFAULT_KPI_VALUES = Object.fromEntries(TEAM_KPIS.map((kpi) => [kpi.key, 5]));

export default function OneOnOnes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [failedPersonPhotos, setFailedPersonPhotos] = useState({});
  const [expandedAudioId, setExpandedAudioId] = useState(null);
  const [audioDataByMeeting, setAudioDataByMeeting] = useState({});
  const [audioUiByMeeting, setAudioUiByMeeting] = useState({});
  const [noteModeByMeeting, setNoteModeByMeeting] = useState({}); // meetingId -> null | "audio" | "text"
  const [textByMeeting, setTextByMeeting] = useState({});
  const [textUiByMeeting, setTextUiByMeeting] = useState({});
  const [kpiPrompt, setKpiPrompt] = useState(null); // { oneOnOneId, submissionId } | null
  const [kpiValues, setKpiValues] = useState({});
  const [kpiUi, setKpiUi] = useState({});
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);
  const recordingMeetingIdRef = useRef("");
  const wakeLockRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const me = await getCurrentUser();
        if (cancelled) return;
        setUser(me);
        if (!me?.id) {
          setItems([]);
          return;
        }
        const data = await listMyOneOnOnes();
        if (cancelled) return;
        setItems(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  // Wake Lock is released by the browser as soon as the tab loses visibility,
  // even briefly (a notification, switching apps) — re-request it as soon as
  // we're back, or the screen can lock mid-recording without any signal.
  const acquireWakeLock = useCallback(async (oneOnOneId) => {
    if (!("wakeLock" in navigator)) {
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: { ...prev[oneOnOneId], wakeLockWarning: true },
      }));
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: { ...prev[oneOnOneId], wakeLockWarning: false },
      }));
    } catch {
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: { ...prev[oneOnOneId], wakeLockWarning: true },
      }));
    }
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && recordingMeetingIdRef.current) {
        acquireWakeLock(recordingMeetingIdRef.current);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [acquireWakeLock]);

  // Whether any meeting has a recorded-but-unsent audio, a typed-but-unsent
  // text note, or a mandatory team rating still open — the most common ways
  // people lose feedback they meant to send.
  const hasUnsentFeedback = useMemo(
    () =>
      Object.values(audioUiByMeeting).some((ui) => ui?.status === "stopped") ||
      Object.values(textByMeeting).some((text) => (text || "").trim()) ||
      Boolean(kpiPrompt),
    [audioUiByMeeting, textByMeeting, kpiPrompt],
  );

  // Warn before closing/refreshing the tab.
  useEffect(() => {
    function handleBeforeUnload(event) {
      if (hasUnsentFeedback) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsentFeedback]);

  // Warn before navigating away inside the app (bottom nav, tapping a
  // meeting's target) — this is how people leave the page most often,
  // and it bypasses beforeunload entirely since the tab never unloads.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => hasUnsentFeedback && currentLocation.pathname !== nextLocation.pathname,
  );

  // The KPI prompt is itself a mandatory blocking step — don't stack the
  // generic "leave without sending?" dialog on top of it, just cancel the
  // navigation attempt silently and let the KPI modal keep the floor.
  useEffect(() => {
    if (blocker.state === "blocked" && kpiPrompt) {
      blocker.reset();
    }
  }, [blocker, kpiPrompt]);

  const groupedItems = useMemo(() => {
    const nowMs = programNow().getTime();
    const todayKey = getTodayKey();

    const rankByDay = (item) => {
      const itemDay = formatDayKey(item.start_time);
      if (itemDay === todayKey) return 0;
      if (new Date(item.start_time).getTime() > nowMs) return 1;
      return 2;
    };

    const sorted = [...items].sort((a, b) => {
      const rankDiff = rankByDay(a) - rankByDay(b);
      if (rankDiff !== 0) return rankDiff;

      const aKey = formatDayKey(a.start_time);
      const bKey = formatDayKey(b.start_time);
      if (aKey === bKey) {
        return new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
      }

      if (rankByDay(a) === 2) return bKey.localeCompare(aKey);
      return aKey.localeCompare(bKey);
    });

    const groups = [];
    for (const item of sorted) {
      const dayKey = formatDayKey(item.start_time);
      const dayLabel = formatDayLabel(item.start_time);
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup || lastGroup.dayKey !== dayKey) {
        groups.push({ dayKey, dayLabel, items: [item] });
      } else {
        lastGroup.items.push(item);
      }
    }
    return groups;
  }, [items]);

  if (loading) return <LoadingState message="Loading your 1:1s" />;
  if (!user) return <UserNotRegisteredError />;
  const canSubmitAudio = user.contact_type === "experience_maker";

  async function ensureAudioLoaded(oneOnOneId) {
    if (audioDataByMeeting[oneOnOneId]) return;
    const data = await getOneOnOneAudio(oneOnOneId);
    setAudioDataByMeeting((prev) => ({ ...prev, [oneOnOneId]: data }));
  }

  async function handleToggleAudio(oneOnOneId) {
    const next = expandedAudioId === oneOnOneId ? null : oneOnOneId;
    setExpandedAudioId(next);
    if (next) {
      try {
        await ensureAudioLoaded(oneOnOneId);
      } catch (error) {
        setAudioUiByMeeting((prev) => ({
          ...prev,
          [oneOnOneId]: {
            ...prev[oneOnOneId],
            status: "error",
            error: error instanceof Error ? error.message : "Could not load audios.",
          },
        }));
      }
    }
  }

  async function startRecording(oneOnOneId) {
    if (!canSubmitAudio) return;
    if (recordingMeetingIdRef.current && recordingMeetingIdRef.current !== oneOnOneId) {
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: {
          ...prev[oneOnOneId],
          status: "error",
          error: "Finish current recording before starting another one.",
        },
      }));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      recordingMeetingIdRef.current = oneOnOneId;
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      // Prevent screen from locking during recording
      await acquireWakeLock(oneOnOneId);

      // Detect microphone interruption (e.g. incoming call, Siri, another app)
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          if (
            recordingMeetingIdRef.current === oneOnOneId &&
            mediaRecorderRef.current?.state !== "inactive"
          ) {
            mediaRecorderRef.current.stop();
            setAudioUiByMeeting((prev) => ({
              ...prev,
              [oneOnOneId]: { ...prev[oneOnOneId], interrupted: true },
            }));
          }
        };
      });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
        recordingMeetingIdRef.current = "";
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        setAudioUiByMeeting((prev) => ({
          ...prev,
          [oneOnOneId]: {
            ...prev[oneOnOneId],
            status: "error",
            error: "Recording error. Please try again.",
          },
        }));
      };

      recorder.onstop = () => {
        wakeLockRef.current?.release();
        wakeLockRef.current = null;
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
        const blob = new Blob(recordingChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const file = new File([blob], `one-on-one-${Date.now()}.webm`, {
          type: recorder.mimeType || "audio/webm",
        });
        const previewUrl = URL.createObjectURL(blob);
        setAudioUiByMeeting((prev) => {
          const wasInterrupted = prev[oneOnOneId]?.interrupted;
          return {
            ...prev,
            [oneOnOneId]: {
              ...prev[oneOnOneId],
              status: "stopped",
              interrupted: false,
              error: wasInterrupted
                ? "The microphone was interrupted. You can still upload the partial recording."
                : "",
              blob,
              file,
              previewUrl,
              durationSec,
            },
          };
        });
        recordingMeetingIdRef.current = "";
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      };

      // Timesliced: collect a chunk every second so interruptions don't lose all data
      recorder.start(1000);
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: {
          ...prev[oneOnOneId],
          status: "recording",
          error: "",
        },
      }));
    } catch (error) {
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: {
          ...prev[oneOnOneId],
          status: "error",
          error: error instanceof Error ? error.message : "Microphone is not available.",
        },
      }));
    }
  }

  function stopRecording(oneOnOneId) {
    if (recordingMeetingIdRef.current !== oneOnOneId) return;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  async function uploadRecording(oneOnOneId) {
    if (!canSubmitAudio) return;
    const ui = audioUiByMeeting[oneOnOneId];
    if (!ui?.file) return;
    setAudioUiByMeeting((prev) => ({
      ...prev,
      [oneOnOneId]: { ...prev[oneOnOneId], status: "uploading", error: "" },
    }));
    try {
      const uploaded = await uploadOneOnOneAudioToStorage(oneOnOneId, ui.file);
      if (!uploaded.publicUrl) throw new Error("Storage did not return a public URL.");
      if (!ui.file.size) throw new Error("Recorded audio file is empty.");
      const created = await registerOneOnOneAudioSubmission(oneOnOneId, {
        storage_path: uploaded.storagePath,
        public_url: uploaded.publicUrl,
        mime_type: ui.file.type || "audio/webm",
        file_size_bytes: ui.file.size,
        duration_sec: ui.durationSec,
        status: "uploaded",
      });
      const refreshed = await getOneOnOneAudio(oneOnOneId);
      setAudioDataByMeeting((prev) => ({ ...prev, [oneOnOneId]: refreshed }));
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: { ...prev[oneOnOneId], status: "success", error: "" },
      }));
      setKpiValues(DEFAULT_KPI_VALUES);
      setKpiUi({});
      setKpiPrompt({ oneOnOneId, submissionId: created.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload audio.";
      await registerOneOnOneAudioSubmission(oneOnOneId, {
        status: "failed",
        error_message: message,
      }).catch(() => {});
      const refreshed = await getOneOnOneAudio(oneOnOneId).catch(() => null);
      if (refreshed) {
        setAudioDataByMeeting((prev) => ({ ...prev, [oneOnOneId]: refreshed }));
      }
      setAudioUiByMeeting((prev) => ({
        ...prev,
        [oneOnOneId]: {
          ...prev[oneOnOneId],
          status: "error",
          error: "Upload failed. Your recording is saved — tap the send button to try again.",
        },
      }));
    }
  }

  function setMeetingNoteMode(oneOnOneId, mode) {
    setNoteModeByMeeting((prev) => ({ ...prev, [oneOnOneId]: mode }));
  }

  async function sendTextFeedback(oneOnOneId) {
    const text = (textByMeeting[oneOnOneId] || "").trim();
    if (!text) return;
    setTextUiByMeeting((prev) => ({ ...prev, [oneOnOneId]: { status: "sending" } }));
    try {
      const created = await registerOneOnOneAudioSubmission(oneOnOneId, { status: "transcribed", transcript_text: text });
      const refreshed = await getOneOnOneAudio(oneOnOneId);
      setAudioDataByMeeting((prev) => ({ ...prev, [oneOnOneId]: refreshed }));
      setTextByMeeting((prev) => ({ ...prev, [oneOnOneId]: "" }));
      setTextUiByMeeting((prev) => ({ ...prev, [oneOnOneId]: { status: "success" } }));
      setKpiValues(DEFAULT_KPI_VALUES);
      setKpiUi({});
      setKpiPrompt({ oneOnOneId, submissionId: created.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send feedback.";
      setTextUiByMeeting((prev) => ({ ...prev, [oneOnOneId]: { status: "error", error: message } }));
    }
  }

  function setKpiValue(kpiKey, value) {
    setKpiValues((prev) => ({ ...prev, [kpiKey]: value }));
  }

  async function submitKpiRating() {
    if (!kpiPrompt) return;
    setKpiUi({ status: "sending" });
    try {
      await submitOneOnOneTeamKpis(kpiPrompt.oneOnOneId, kpiPrompt.submissionId, { ...DEFAULT_KPI_VALUES, ...kpiValues });
      setKpiPrompt(null);
      setKpiValues({});
      setKpiUi({});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the rating.";
      setKpiUi({ status: "error", error: message });
    }
  }

  function formatAudioDuration(seconds) {
    const safe = Number(seconds) || 0;
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

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
            className="decelera-mx-mark pointer-events-none absolute"
            style={{ right: -56, bottom: -56, height: 210, width: 210, color: "#2D3852" }}
          >
            <DeceleraRosetteMark />
          </div>
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Your 1:1&apos;s
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Your scheduled person-to-person meetings</p>
          </Motion.div>
        </div>

        {groupedItems.length === 0 ? (
          <div className="rounded-[20px] border" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
            <EmptyState icon={Users} title="No 1:1 meetings scheduled" hint="Your person-to-person meetings will show up here." />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groupedItems.map((group, groupIndex) => (
              <section key={group.dayKey}>
                <h2 style={{ fontFamily: "Taviraj, serif", fontWeight: 600, fontSize: 18, color: "#2D3852", marginBottom: 10 }}>
                  {group.dayLabel}
                </h2>
                <div className="card-list">
                  {group.items.map((item, i) => {
                    const isEMUser = user?.contact_type === "experience_maker";
                    const targetLabel = isEMUser ? item.startup_name : item.em_name;
                    const targetPhotoUrl = isEMUser ? item.startup_logo_url : item.em_photo_url;
                    const targetPath = isEMUser
                      ? item.startup_id ? `/startup/${item.startup_id}` : ""
                      : item.em_id ? `/person/${item.em_id}` : "";
                    const personInitials = (targetLabel || "?")
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .toUpperCase()
                      .slice(0, 2);
                    const animationIndex = groupIndex * 8 + i;
                    const audioUi = audioUiByMeeting[item.id] || {};
                    const audioData = audioDataByMeeting[item.id] || {};
                    const isRecording = audioUi.status === "recording";
                    const isUploading = audioUi.status === "uploading";
                    const activeDuration = audioData?.active_audio?.duration_sec || 0;
                    const noteMode = noteModeByMeeting[item.id] || null;
                    const textNote = textByMeeting[item.id] || "";
                    const textUi = textUiByMeeting[item.id] || {};
                    const isSendingText = textUi.status === "sending";
                    const hasUnsentFeedback = audioUi.status === "stopped" || Boolean(textNote.trim());

                    return (
                      <Motion.div
                        key={item.id}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ ...SPRING, delay: stagger(animationIndex) }}
                        className="rounded-[20px] border overflow-hidden"
                        style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            if (targetPath) navigate(targetPath);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              if (targetPath) navigate(targetPath);
                            }
                          }}
                          className="cursor-pointer transition-all duration-200 hover:brightness-[0.98]"
                          style={{ padding: "14px 16px" }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                            {targetPhotoUrl && !failedPersonPhotos[item.id] ? (
                              <div
                                className="overflow-hidden flex-shrink-0"
                                style={{
                                  width: 46,
                                  height: 46,
                                  borderRadius: 14,
                                  background: "#EDF1F4",
                                  boxShadow: "0 3px 8px rgba(45,56,82,0.12), inset 0 0 0 1px rgba(45,56,82,0.05)",
                                }}
                              >
                                <img
                                  src={targetPhotoUrl}
                                  alt={targetLabel || "Person"}
                                  referrerPolicy="no-referrer"
                                  onError={() => setFailedPersonPhotos((prev) => ({ ...prev, [item.id]: true }))}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div
                                className="flex items-center justify-center flex-shrink-0"
                                style={{
                                  width: 46,
                                  height: 46,
                                  borderRadius: 14,
                                  background: "#EDF1F4",
                                  boxShadow: "0 3px 8px rgba(45,56,82,0.12), inset 0 0 0 1px rgba(45,56,82,0.05)",
                                  color: "#2D3852",
                                  fontWeight: 700,
                                  fontSize: 14,
                                }}
                              >
                                {personInitials}
                              </div>
                            )}

                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p
                                style={{
                                  margin: 0,
                                  fontFamily: "Taviraj, Georgia, serif",
                                  fontSize: 15.5,
                                  fontWeight: 500,
                                  lineHeight: 1.2,
                                  letterSpacing: "-0.01em",
                                  color: "#2D3852",
                                }}
                                className="truncate"
                              >
                                {targetLabel}
                              </p>
                              <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <Clock size={13} color="#0A859B" style={{ flexShrink: 0 }} />
                                  <span style={{ fontSize: 12, color: "#6E7892" }}>
                                    {formatTime24(item.start_time)} – {formatTime24(item.end_time)}
                                  </span>
                                </div>
                                {item.location && (
                                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                    <MapPin size={13} color="#0A859B" style={{ flexShrink: 0 }} />
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: "#6E7892",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                      }}
                                    >
                                      {item.location}
                                    </span>
                                  </div>
                                )}
                              </div>
                              {item.notes && (
                                <p style={{ fontSize: 11, color: "#9AA3B8", marginTop: 5 }} className="line-clamp-2">
                                  {item.notes}
                                </p>
                              )}
                            </div>

                            {targetPath ? <ChevronRight size={16} color="#B9C1D4" style={{ flexShrink: 0 }} /> : null}
                          </div>
                        </div>

                        {canSubmitAudio ? (
                          <Motion.div layout className="mx-[10px] mb-[10px] rounded-[12px] px-[12px] py-[9px]" style={{ background: "#F2F8FA" }}>
                            <div className="one-on-one-audio-header">
                              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0A859B", margin: 0 }}>
                                  Send Post Session Feedback
                                </p>
                                {hasUnsentFeedback && (
                                  <span
                                    title="You have unsent feedback"
                                    style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF9950", flexShrink: 0 }}
                                  />
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => handleToggleAudio(item.id)}
                                style={{ border: 0, background: "transparent", color: "#0A859B", fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.01em", cursor: "pointer" }}
                              >
                                {expandedAudioId === item.id ? "Close" : "Open"}
                              </button>
                            </div>

                            <AnimatePresence initial={false}>
                              {expandedAudioId === item.id ? (
                                <Motion.div
                                  initial={{ opacity: 0, height: 0, y: -6 }}
                                  animate={{ opacity: 1, height: "auto", y: 0 }}
                                  exit={{ opacity: 0, height: 0, y: -6 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="one-on-one-audio-body">
                                    <div style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid #E2E9EE" }}>
                                      <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A859B", marginBottom: 5 }}>
                                        Post-session feedback
                                      </p>
                                      <p style={{ fontSize: 10.5, color: "#6E7892", lineHeight: 1.55, marginBottom: 5 }}>
                                        Record a short voice note or type it covering the following areas. Rate each 1–5 where relevant.
                                      </p>
                                      <ul style={{ fontSize: 10.5, color: "#6E7892", lineHeight: 1.65, paddingLeft: 14, margin: 0 }}>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>State of development</span> — current product or project maturity</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Momentum</span> — pace of progress and execution speed</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Management</span> — leadership capacity and decision-making</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Market</span> — market opportunity and competitive positioning</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Team</span> — team composition, cohesion, and capability</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Pain</span> — clarity and severity of the problem being solved</li>
                                        <li><span style={{ fontWeight: 600, color: "#2D3852" }}>Scalability</span> — potential to grow significantly</li>
                                      </ul>
                                    </div>
                                    {audioUi.previewUrl ? (
                                      <div>
                                        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 8 }}>
                                          <Check size={12} color="#0A859B" />
                                          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#0A859B" }}>
                                            {audioUi.status === "success" ? "Sent" : "Audio recorded"}
                                          </span>
                                        </div>
                                        <AudioPlayer src={audioUi.previewUrl} />
                                        <button
                                          type="button"
                                          onClick={() => uploadRecording(item.id)}
                                          disabled={!canSubmitAudio || isUploading || audioUi.status === "success"}
                                          style={{
                                            width: "100%",
                                            marginTop: 10,
                                            borderRadius: 12,
                                            border: "none",
                                            background: audioUi.status === "success" ? "#EEF2F5" : "#1FD0EF",
                                            color: audioUi.status === "success" ? "#6E7892" : "#2D3852",
                                            padding: "10px 0",
                                            fontFamily: "Fustat, sans-serif",
                                            fontWeight: 700,
                                            fontSize: 13,
                                            cursor: !canSubmitAudio || isUploading || audioUi.status === "success" ? "default" : "pointer",
                                            opacity: isUploading ? 0.65 : 1,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 6,
                                            transition: "opacity 0.15s",
                                          }}
                                        >
                                          {audioUi.status === "success" ? (
                                            <>
                                              <Check size={14} /> Sent
                                            </>
                                          ) : isUploading ? (
                                            "Sending…"
                                          ) : (
                                            <>
                                              <Upload size={14} /> Send
                                            </>
                                          )}
                                        </button>
                                      </div>
                                    ) : noteMode === "text" ? (
                                      <div>
                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                                          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A859B", margin: 0 }}>
                                            Write your feedback
                                          </p>
                                          <button
                                            type="button"
                                            onClick={() => setMeetingNoteMode(item.id, null)}
                                            style={{ border: 0, background: "transparent", cursor: "pointer", color: "#6E7892", fontSize: 11, fontWeight: 600, padding: 0 }}
                                          >
                                            Change
                                          </button>
                                        </div>
                                        <textarea
                                          value={textNote}
                                          onChange={(e) => setTextByMeeting((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                          placeholder="Type your feedback…"
                                          disabled={isSendingText || textUi.status === "success"}
                                          style={{
                                            width: "100%",
                                            minHeight: 90,
                                            borderRadius: 12,
                                            border: "1.5px solid #E4EAF0",
                                            padding: "10px 12px",
                                            fontSize: 13,
                                            color: "#2D3852",
                                            fontFamily: "Fustat, sans-serif",
                                            outline: "none",
                                            background: "#FFFFFF",
                                            boxSizing: "border-box",
                                            resize: "vertical",
                                          }}
                                        />
                                        <button
                                          type="button"
                                          onClick={() => sendTextFeedback(item.id)}
                                          disabled={!textNote.trim() || isSendingText || textUi.status === "success"}
                                          style={{
                                            width: "100%",
                                            marginTop: 10,
                                            borderRadius: 12,
                                            border: "none",
                                            background: textUi.status === "success" ? "#EEF2F5" : "#1FD0EF",
                                            color: textUi.status === "success" ? "#6E7892" : "#2D3852",
                                            padding: "10px 0",
                                            fontFamily: "Fustat, sans-serif",
                                            fontWeight: 700,
                                            fontSize: 13,
                                            cursor: !textNote.trim() || isSendingText || textUi.status === "success" ? "default" : "pointer",
                                            opacity: isSendingText ? 0.65 : 1,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 6,
                                            transition: "opacity 0.15s",
                                          }}
                                        >
                                          {textUi.status === "success" ? (
                                            <>
                                              <Check size={14} /> Sent
                                            </>
                                          ) : isSendingText ? (
                                            "Sending…"
                                          ) : (
                                            <>
                                              <Upload size={14} /> Send
                                            </>
                                          )}
                                        </button>
                                        {textUi.error ? (
                                          <p style={{ fontSize: 11, color: "#D9534F", margin: "6px 0 0" }}>{textUi.error}</p>
                                        ) : null}
                                      </div>
                                    ) : noteMode === "audio" ? (
                                      <div>
                                        <div className="one-on-one-audio-composer">
                                          <button
                                            type="button"
                                            onClick={() => (isRecording ? stopRecording(item.id) : startRecording(item.id))}
                                            disabled={!canSubmitAudio}
                                            className={`one-on-one-audio-mic-btn ${isRecording ? "is-recording" : ""}`}
                                          >
                                            {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                                          </button>

                                          <div className="one-on-one-audio-track">
                                            {isRecording ? (
                                              <div className="one-on-one-audio-wave">
                                                {Array.from({ length: 18 }).map((_, waveIndex) => (
                                                  <Motion.span
                                                    key={waveIndex}
                                                    className="one-on-one-audio-wave-bar"
                                                    animate={{ scaleY: [0.45, 1, 0.35, 0.9, 0.45] }}
                                                    transition={{
                                                      duration: 1.1,
                                                      repeat: Number.POSITIVE_INFINITY,
                                                      delay: waveIndex * 0.04,
                                                    }}
                                                  />
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="one-on-one-audio-caption">Tap the mic to record</p>
                                            )}
                                          </div>
                                        </div>
                                        {isRecording && audioUi.wakeLockWarning ? (
                                          <p style={{ fontSize: 10.5, color: "#B8862B", background: "#FFF4E5", borderRadius: 8, padding: "6px 8px", marginTop: 8 }}>
                                            Keep the screen on while recording — this device can't hold it awake automatically.
                                          </p>
                                        ) : null}
                                      </div>
                                    ) : (
                                      <div>
                                        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A859B", marginBottom: 8 }}>
                                          What do you want to send?
                                        </p>
                                        <div style={{ display: "flex", gap: 6 }}>
                                          <button
                                            type="button"
                                            onClick={() => setMeetingNoteMode(item.id, "audio")}
                                            style={{
                                              flex: 1,
                                              borderRadius: 10,
                                              border: "1.5px solid #E4EAF0",
                                              background: "transparent",
                                              color: "#6E7892",
                                              padding: "10px 0",
                                              fontFamily: "Fustat, sans-serif",
                                              fontWeight: 700,
                                              fontSize: 12,
                                              cursor: "pointer",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              gap: 6,
                                            }}
                                          >
                                            <Mic className="h-3.5 w-3.5" /> Audio
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setMeetingNoteMode(item.id, "text")}
                                            style={{
                                              flex: 1,
                                              borderRadius: 10,
                                              border: "1.5px solid #E4EAF0",
                                              background: "transparent",
                                              color: "#6E7892",
                                              padding: "10px 0",
                                              fontFamily: "Fustat, sans-serif",
                                              fontWeight: 700,
                                              fontSize: 12,
                                              cursor: "pointer",
                                              display: "flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              gap: 6,
                                            }}
                                          >
                                            <PenLine className="h-3.5 w-3.5" /> Text
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    {audioData?.active_audio?.url ? (
                                      <div className="one-on-one-audio-player-wrap">
                                        <div className="one-on-one-audio-player-meta">
                                          <span>Latest audio</span>
                                          {activeDuration > 0 ? <span>{formatAudioDuration(activeDuration)}</span> : null}
                                        </div>
                                        <AudioPlayer src={audioData.active_audio.url} />
                                      </div>
                                    ) : audioData?.transcript ? (
                                      <p style={{
                                        fontSize: 12,
                                        color: "#4A5573",
                                        lineHeight: 1.65,
                                        margin: 0,
                                        padding: "8px 10px",
                                        borderRadius: 8,
                                        background: "#F2F8FA",
                                        border: "1px solid #E4EAF0",
                                      }}>
                                        {audioData.transcript}
                                      </p>
                                    ) : (
                                      <p style={{ fontSize: 11, color: "#9AA3B8", margin: 0 }}>No feedback sent yet.</p>
                                    )}

                                    {audioUi.error ? (
                                      <p style={{ fontSize: 11, color: "#D9534F", margin: 0 }}>{audioUi.error}</p>
                                    ) : null}

                                    {audioData?.submissions?.length ? (
                                      <div>
                                        <p
                                          style={{
                                            fontSize: 10,
                                            fontWeight: 700,
                                            textTransform: "uppercase",
                                            letterSpacing: "0.06em",
                                            color: "#9AA3B8",
                                            margin: "0 0 4px",
                                          }}
                                        >
                                          Attempts
                                        </p>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                          {audioData.submissions.slice(0, 3).map((submission) => (
                                            <p key={submission.id} style={{ fontSize: 11, color: "#9AA3B8", margin: 0 }}>
                                              {formatShortDateTime(submission.createdat || submission.createdAt)} ·{" "}
                                              {submission.status}
                                            </p>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </Motion.div>
                              ) : null}
                            </AnimatePresence>
                          </Motion.div>
                        ) : null}
                      </Motion.div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {blocker.state === "blocked" && !kpiPrompt ? (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(45,56,82,0.45)",
              zIndex: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <Motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              style={{ background: "#FFFFFF", borderRadius: 20, padding: 20, width: "100%", maxWidth: 320 }}
            >
              <p style={{ fontFamily: "Taviraj, serif", fontWeight: 500, fontSize: 17, color: "#2D3852", margin: "0 0 6px" }}>
                Leave without sending?
              </p>
              <p style={{ fontSize: 12.5, color: "#6E7892", lineHeight: 1.5, margin: "0 0 16px" }}>
                You have feedback that hasn&apos;t been sent yet. If you leave now, it will be lost.
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => blocker.reset()}
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    border: "1.5px solid #E4EAF0",
                    background: "transparent",
                    color: "#2D3852",
                    padding: "10px 0",
                    fontFamily: "Fustat, sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Stay
                </button>
                <button
                  type="button"
                  onClick={() => blocker.proceed()}
                  style={{
                    flex: 1,
                    borderRadius: 12,
                    border: "none",
                    background: "#1FD0EF",
                    color: "#2D3852",
                    padding: "10px 0",
                    fontFamily: "Fustat, sans-serif",
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: "pointer",
                  }}
                >
                  Leave anyway
                </button>
              </div>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {kpiPrompt ? (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(45,56,82,0.55)",
              zIndex: 110,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <Motion.div
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={SPRING}
              style={{ background: "#FFFFFF", borderRadius: 20, padding: 22, width: "100%", maxWidth: 340, maxHeight: "88vh", overflowY: "auto" }}
            >
              <p style={{ fontFamily: "Taviraj, serif", fontWeight: 500, fontSize: 19, color: "#2D3852", margin: "0 0 4px" }}>
                Rate the team
              </p>
              <p style={{ fontSize: 12, color: "#6E7892", lineHeight: 1.5, margin: "0 0 18px" }}>
                Before moving on, score the founding team from 1 (low) to 10 (high) on each of these.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {TEAM_KPIS.map((kpi) => {
                  const value = kpiValues[kpi.key] ?? 5;
                  return (
                    <div key={kpi.key}>
                      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#2D3852", margin: 0 }}>{kpi.label}</p>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#0A859B" }}>{value}</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        step={1}
                        value={value}
                        onChange={(e) => setKpiValue(kpi.key, Number(e.target.value))}
                        style={{ width: "100%", accentColor: "#1FD0EF" }}
                      />
                    </div>
                  );
                })}
              </div>

              {kpiUi.error ? (
                <p style={{ fontSize: 11, color: "#D9534F", margin: "12px 0 0" }}>{kpiUi.error}</p>
              ) : null}

              <button
                type="button"
                onClick={submitKpiRating}
                disabled={kpiUi.status === "sending"}
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
                  cursor: kpiUi.status === "sending" ? "default" : "pointer",
                  opacity: kpiUi.status === "sending" ? 0.65 : 1,
                }}
              >
                {kpiUi.status === "sending" ? "Saving…" : "Submit"}
              </button>
            </Motion.div>
          </Motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

