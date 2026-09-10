import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, MapPin, Mic, Square, Upload, Users } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  getCurrentUser,
  getOneOnOneAudio,
  listMyOneOnOnes,
  registerOneOnOneAudioSubmission,
  uploadOneOnOneAudioToStorage,
} from "../api/dataService";
import {
  formatDayKey,
  formatDayLabel,
  formatShortDateTime,
  formatTime24,
  getTodayKey,
} from "../lib/dateTime";
import LoadingState from "../components/LoadingState";
import UserNotRegisteredError from "./UserNotRegisteredError";
import { SPRING, stagger } from "../lib/motion";

export default function OneOnOnes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [failedPersonPhotos, setFailedPersonPhotos] = useState({});
  const [expandedAudioId, setExpandedAudioId] = useState(null);
  const [audioDataByMeeting, setAudioDataByMeeting] = useState({});
  const [audioUiByMeeting, setAudioUiByMeeting] = useState({});
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

  const groupedItems = useMemo(() => {
    const nowMs = Date.now();
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
      try {
        if (navigator.wakeLock) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch (_) {}

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
      await registerOneOnOneAudioSubmission(oneOnOneId, {
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
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Your 1:1&apos;s
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Your scheduled person-to-person meetings</p>
          </Motion.div>
        </div>

        {groupedItems.length === 0 ? (
          <div
            className="rounded-[20px] border px-[18px] py-10 text-center"
            style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
          >
            <Users className="h-8 w-8 mx-auto mb-3" style={{ color: "#B9C1D4" }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852" }}>No 1:1 meetings scheduled</p>
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
                    const hasPendingAudio = Boolean(audioUi.file);
                    const activeDuration = audioData?.active_audio?.duration_sec || 0;

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
                          style={{ padding: "10px 14px" }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "2.75rem minmax(0,1fr)", columnGap: "0.75rem", alignItems: "start" }}>
                            <div style={{ paddingTop: 2 }}>
                              {targetPhotoUrl && !failedPersonPhotos[item.id] ? (
                                <div
                                  className="overflow-hidden bg-white"
                                  style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, border: "1px solid #E2E7ED" }}
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
                                  className="flex items-center justify-center font-bold text-sm"
                                  style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, background: "#1FD0EF", color: "#2D3852" }}
                                >
                                  {personInitials}
                                </div>
                              )}
                            </div>
                            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: "#2D3852", lineHeight: 1.1, marginBottom: 2 }} className="truncate">{targetLabel}</p>
                              <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
                                <Clock style={{ width: "1rem", height: "1rem", flex: "0 0 1rem", color: "#1FD0EF" }} />
                                <p style={{ fontSize: 13, color: "#6E7892", lineHeight: 1 }}>
                                  {formatTime24(item.start_time)} – {formatTime24(item.end_time)}
                                </p>
                              </div>
                              {item.location && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0, marginTop: -12 }}>
                                  <MapPin style={{ width: "1rem", height: "1rem", flex: "0 0 1rem", color: "#1FD0EF" }} />
                                  <p style={{ fontSize: 13, color: "#6E7892", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.location}</p>
                                </div>
                              )}
                              {item.notes && (
                                <p style={{ fontSize: 11, color: "#6E7892" }} className="line-clamp-2">{item.notes}</p>
                              )}
                            </div>
                          </div>
                        </div>

                        {canSubmitAudio ? (
                          <Motion.div layout className="mx-[10px] mb-[10px] rounded-[12px] px-[12px] py-[9px]" style={{ background: "#F2F8FA" }}>
                            <div className="one-on-one-audio-header">
                              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0A859B" }}>
                                Send Post Session Feedback
                              </p>
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
                                        Record a short voice note covering the following areas. Rate each 1–5 where relevant.
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
                                        ) : isUploading ? (
                                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <Motion.div
                                              animate={{ y: [0, -5, 0] }}
                                              transition={{ duration: 0.85, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                                            >
                                              <Upload style={{ width: 14, height: 14, color: "#0A859B" }} />
                                            </Motion.div>
                                            <p className="one-on-one-audio-caption">Uploading...</p>
                                          </div>
                                        ) : (
                                          <p className="one-on-one-audio-caption">
                                            {audioUi.previewUrl
                                              ? `Ready to send (${formatAudioDuration(audioUi.durationSec || 0)})`
                                              : "Tap the mic to record"}
                                          </p>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => uploadRecording(item.id)}
                                        disabled={!canSubmitAudio || !hasPendingAudio || isUploading}
                                        className="one-on-one-audio-send-btn"
                                      >
                                        <Upload className="h-3.5 w-3.5" />
                                      </button>
                                    </div>

                                    {audioData?.active_audio?.url ? (
                                      <div className="one-on-one-audio-player-wrap">
                                        <div className="one-on-one-audio-player-meta">
                                          <span>Latest audio</span>
                                          {activeDuration > 0 ? <span>{formatAudioDuration(activeDuration)}</span> : null}
                                        </div>
                                        <audio controls src={audioData.active_audio.url} className="w-full" />
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-muted-foreground">No audio uploaded yet.</p>
                                    )}

                                    {audioUi.previewUrl && audioUi.status !== "success" ? (
                                      <audio controls src={audioUi.previewUrl} className="w-full" />
                                    ) : null}

                                    {audioUi.error ? (
                                      <p className="text-[11px] text-rose-600">{audioUi.error}</p>
                                    ) : null}

                                    {audioData?.submissions?.length ? (
                                      <div>
                                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                                          Attempts
                                        </p>
                                        <div className="space-y-1">
                                          {audioData.submissions.slice(0, 3).map((submission) => (
                                            <p key={submission.id} className="text-[11px] text-muted-foreground">
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
    </div>
  );
}

