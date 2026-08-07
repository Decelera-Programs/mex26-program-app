import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import moment from "moment";
import { Building2, ChevronDown, ChevronUp, Mic, Square, Upload, User, X } from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  getCurrentUser,
  listMyTeamNotes,
  listPeople,
  listStartups,
  submitTeamAudioNote,
  uploadTeamAudioToStorage,
} from "../api/dataService";
import LoadingState from "../components/LoadingState";
import UserNotRegisteredError from "./UserNotRegisteredError";

export default function TeamNotes() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [notes, setNotes] = useState([]);
  const [notesError, setNotesError] = useState(null);
  const [allStartups, setAllStartups] = useState([]);
  const [allPeople, setAllPeople] = useState([]);
  const [failedPhotos, setFailedPhotos] = useState({});
  const [openTranscripts, setOpenTranscripts] = useState({});

  // Composer
  const [composerOpen, setComposerOpen] = useState(false);
  const [targetType, setTargetType] = useState("startup");
  const [search, setSearch] = useState("");
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [audioUi, setAudioUi] = useState({});

  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingStartedAtRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        const me = await getCurrentUser();
        if (cancelled) return;
        setUser(me);
        if (!me?.id || me.contact_type !== "team") return;
        const [startups, people] = await Promise.all([listStartups(), listPeople()]);
        if (cancelled) return;
        setAllStartups(startups || []);
        setAllPeople((people || []).filter((p) => !p.contact_type || p.contact_type === "founder" || p.startup_id));
        try {
          const existingNotes = await listMyTeamNotes();
          if (cancelled) return;
          setNotes(existingNotes);
        } catch (err) {
          if (!cancelled) setNotesError(err?.message || "Failed to load notes");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, []);

  const filteredTargets = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (targetType === "startup") {
      return allStartups.filter((s) => !q ||
        (s.name || "").toLowerCase().includes(q) ||
        (s.tagline || "").toLowerCase().includes(q) ||
        (s.sector || "").toLowerCase().includes(q)
      ).slice(0, 25);
    }
    return allPeople
      .filter((p) => !q || p.full_name?.toLowerCase().includes(q) || p.company_name?.toLowerCase().includes(q))
      .slice(0, 25);
  }, [targetType, search, allStartups, allPeople]);

  if (loading) return <LoadingState message="Loading team notes" />;
  if (!user) return <UserNotRegisteredError />;

  if (user.contact_type !== "team") {
    return (
      <div className="w-full pt-[30px] pb-6" style={{ background: "#F2F8FA" }}>
        <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">
          <div className="rounded-[20px] border px-[18px] py-10 text-center" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852" }}>Only team members can access this section.</p>
          </div>
        </div>
      </div>
    );
  }

  const isRecording = audioUi.status === "recording";
  const isUploading = audioUi.status === "uploading";
  const hasPendingAudio = Boolean(audioUi.file);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const durationSec = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000));
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `team-note-${Date.now()}.webm`, { type: recorder.mimeType || "audio/webm" });
        const previewUrl = URL.createObjectURL(blob);
        setAudioUi({ status: "stopped", blob, file, previewUrl, durationSec, error: "" });
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      };
      recorder.start();
      setAudioUi({ status: "recording", error: "" });
    } catch (error) {
      setAudioUi({ status: "error", error: error instanceof Error ? error.message : "Microphone not available." });
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  async function uploadNote() {
    if (!selectedTarget || !audioUi.file) return;
    setAudioUi((prev) => ({ ...prev, status: "uploading", error: "" }));
    const targetId = selectedTarget.id;
    try {
      const uploaded = await uploadTeamAudioToStorage(targetType, targetId, audioUi.file);
      await submitTeamAudioNote({
        target_type: targetType,
        ...(targetType === "startup" ? { startup_id: targetId } : { founder_id: targetId }),
        storage_path: uploaded.storagePath,
        public_url: uploaded.publicUrl,
        mime_type: audioUi.file.type || "audio/webm",
        file_size_bytes: audioUi.file.size,
        duration_sec: audioUi.durationSec,
        status: "uploaded",
      });
      const refreshed = await listMyTeamNotes();
      setNotes(refreshed);
      setAudioUi({ status: "success" });
      setTimeout(() => {
        setComposerOpen(false);
        setSelectedTarget(null);
        setSearch("");
        setAudioUi({});
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not upload note.";
      submitTeamAudioNote({
        target_type: targetType,
        ...(targetType === "startup" ? { startup_id: targetId } : { founder_id: targetId }),
        status: "failed",
        error_message: message,
      }).catch(() => {});
      setAudioUi((prev) => ({ ...prev, status: "error", error: message }));
    }
  }

  function resetComposer() {
    if (mediaRecorderRef.current?.state !== "inactive") mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    setSelectedTarget(null);
    setSearch("");
    setAudioUi({});
    setComposerOpen(false);
  }

  function formatDuration(seconds) {
    const safe = Number(seconds) || 0;
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  }

  const targetName = selectedTarget
    ? targetType === "startup" ? selectedTarget.name : selectedTarget.full_name
    : null;
  const targetPhoto = selectedTarget
    ? targetType === "startup" ? selectedTarget.logo_url : selectedTarget.photo_url
    : null;

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

        {/* Header */}
        <div
          className="relative overflow-hidden"
          style={{ borderRadius: 20, padding: 22, background: "#FAF3DC", color: "#2D3852", boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)", marginBottom: 18 }}
        >
          <div className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full" style={{ background: "rgba(45, 56, 82, 0.18)" }} />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Team Notes
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Voice notes on startups and founders</p>
          </Motion.div>
        </div>

        {/* New note toggle */}
        <button
          type="button"
          onClick={() => composerOpen ? resetComposer() : setComposerOpen(true)}
          style={{
            width: "100%",
            borderRadius: 16,
            border: "1.5px solid",
            borderColor: composerOpen ? "#E2E9EE" : "#1FD0EF",
            background: composerOpen ? "#FFFFFF" : "#1FD0EF",
            color: composerOpen ? "#6E7892" : "#2D3852",
            padding: "11px 16px",
            fontFamily: "Fustat, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            transition: "all 0.18s",
          }}
        >
          {composerOpen ? <><X className="h-4 w-4" /> Cancel</> : <><Mic className="h-4 w-4" /> New Note</>}
        </button>

        {/* Composer */}
        <AnimatePresence initial={false}>
          {composerOpen && (
            <Motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden"
              style={{ marginBottom: 14 }}
            >
              <div className="rounded-[20px] border" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
                <div style={{ padding: "14px 16px" }}>

                  {/* Target type tabs */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {[
                      { key: "startup", label: "Startup", icon: Building2 },
                      { key: "founder", label: "Founder", icon: User },
                    ].map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => { setTargetType(key); setSelectedTarget(null); setSearch(""); setAudioUi({}); }}
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          border: "1.5px solid",
                          borderColor: targetType === key ? "#1FD0EF" : "#E2E9EE",
                          background: targetType === key ? "#E8FBFE" : "transparent",
                          color: targetType === key ? "#0A859B" : "#6E7892",
                          padding: "8px 0",
                          fontFamily: "Fustat, sans-serif",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 5,
                          transition: "all 0.15s",
                        }}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* Selected target row */}
                  {selectedTarget ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, padding: "8px 10px", borderRadius: 12, background: "#F2F8FA", border: "1px solid #E2E9EE" }}>
                      {targetPhoto && !failedPhotos[selectedTarget.id] ? (
                        <div style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", border: "1px solid #E2E9EE", flexShrink: 0 }}>
                          <img
                            src={targetPhoto}
                            alt={targetName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={() => setFailedPhotos((prev) => ({ ...prev, [selectedTarget.id]: true }))}
                          />
                        </div>
                      ) : (
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1FD0EF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#2D3852" }}>{(targetName || "?")[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#2D3852", flex: 1 }}>{targetName}</span>
                      <button
                        type="button"
                        onClick={() => { setSelectedTarget(null); setAudioUi({}); }}
                        style={{ border: 0, background: "transparent", cursor: "pointer", color: "#6E7892", padding: 2, display: "flex" }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        placeholder={`Search ${targetType === "startup" ? "startups" : "founders"}…`}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{
                          width: "100%",
                          borderRadius: 10,
                          border: "1.5px solid #E2E9EE",
                          padding: "8px 12px",
                          fontSize: 13,
                          color: "#2D3852",
                          fontFamily: "Fustat, sans-serif",
                          marginBottom: 6,
                          outline: "none",
                          background: "#F9FBFC",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ maxHeight: 200, overflowY: "auto" }}>
                        {filteredTargets.length === 0 ? (
                          <p style={{ fontSize: 12, color: "#6E7892", textAlign: "center", padding: "10px 0" }}>No results</p>
                        ) : filteredTargets.map((item) => {
                          const name = targetType === "startup" ? item.name : item.full_name;
                          const photo = targetType === "startup" ? item.logo_url : item.photo_url;
                          const sub = targetType === "startup" ? item.sector : (item.company_name || item.startup?.name);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => { setSelectedTarget(item); setSearch(""); setAudioUi({}); }}
                              style={{
                                width: "100%",
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "7px 8px",
                                borderRadius: 10,
                                border: "none",
                                background: "transparent",
                                cursor: "pointer",
                                textAlign: "left",
                                transition: "background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "#F2F8FA"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                            >
                              {photo && !failedPhotos[item.id] ? (
                                <div style={{ width: 32, height: 32, borderRadius: 8, overflow: "hidden", border: "1px solid #E2E9EE", flexShrink: 0 }}>
                                  <img src={photo} alt={name} referrerPolicy="no-referrer" className="w-full h-full object-cover" onError={() => setFailedPhotos((prev) => ({ ...prev, [item.id]: true }))} />
                                </div>
                              ) : (
                                <div style={{ width: 32, height: 32, borderRadius: 8, background: "#1FD0EF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#2D3852" }}>{(name || "?")[0]?.toUpperCase()}</span>
                                </div>
                              )}
                              <div>
                                <p style={{ fontSize: 13, fontWeight: 600, color: "#2D3852", margin: 0, lineHeight: 1.2 }}>{name}</p>
                                {sub && <p style={{ fontSize: 11, color: "#6E7892", margin: 0 }}>{sub}</p>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Recorder — shown only after picking a target */}
                  {selectedTarget && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E2E9EE" }}>
                      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0A859B", marginBottom: 8 }}>
                        Record your note
                      </p>
                      <div className="one-on-one-audio-composer">
                        <button
                          type="button"
                          onClick={() => isRecording ? stopRecording() : startRecording()}
                          className={`one-on-one-audio-mic-btn ${isRecording ? "is-recording" : ""}`}
                        >
                          {isRecording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                        </button>
                        <div className="one-on-one-audio-track">
                          {isRecording || isUploading ? (
                            <div className="one-on-one-audio-wave">
                              {Array.from({ length: 18 }).map((_, waveIdx) => (
                                <Motion.span
                                  key={waveIdx}
                                  className="one-on-one-audio-wave-bar"
                                  animate={{ scaleY: [0.45, 1, 0.35, 0.9, 0.45] }}
                                  transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY, delay: waveIdx * 0.04 }}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="one-on-one-audio-caption">
                              {audioUi.status === "success"
                                ? "Sent!"
                                : audioUi.previewUrl
                                  ? `Ready (${formatDuration(audioUi.durationSec || 0)})`
                                  : "Tap mic to record"}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={uploadNote}
                          disabled={!hasPendingAudio || isUploading}
                          className="one-on-one-audio-send-btn"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {audioUi.previewUrl && audioUi.status !== "success" && (
                        <audio controls src={audioUi.previewUrl} className="w-full mt-2" />
                      )}
                      {audioUi.error && (
                        <p className="text-[11px] text-rose-600 mt-1">{audioUi.error}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Motion.div>
          )}
        </AnimatePresence>

        {/* Notes list */}
        {notesError && (
          <div className="rounded-[20px] border px-[18px] py-4 text-center" style={{ background: "#FFF4F4", borderColor: "#FFD5D5" }}>
            <p style={{ fontSize: 12, color: "#C0392B" }}>Could not load notes: {notesError}</p>
          </div>
        )}
        {!notesError && notes.length === 0 && !composerOpen ? (
          <div className="rounded-[20px] border px-[18px] py-10 text-center" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
            <Mic className="h-8 w-8 mx-auto mb-3" style={{ color: "#B9C1D4" }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852" }}>No notes yet</p>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 4 }}>Tap "New Note" to record your first voice note</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[14px]">
            {notes.map((note, i) => {
              const name = note.startup?.name || note.founder?.full_name || "Unknown";
              const photo = note.startup?.logo_url || note.founder?.photo_url;
              const targetPath = note.startup
                ? `/startup/${note.startup.id}`
                : note.founder
                  ? `/person/${note.founder.id}`
                  : "";
              const isTranscribed = note.status === "transcribed";
              const transcriptOpen = Boolean(openTranscripts[note.id]);

              return (
                <Motion.div
                  key={note.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="rounded-[20px] border overflow-hidden"
                  style={{ background: "#FFFFFF", borderColor: "#EEF2F5", boxShadow: "0 2px 12px rgba(45,56,82,0.06)" }}
                >
                  <div style={{ padding: "12px 14px" }}>
                    {/* Target header */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => targetPath && navigate(targetPath)}
                      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && targetPath) navigate(targetPath); }}
                      className="cursor-pointer"
                      style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}
                    >
                      {photo && !failedPhotos[note.id] ? (
                        <div style={{ width: 36, height: 36, borderRadius: 10, overflow: "hidden", border: "1px solid #E2E9EE", flexShrink: 0 }}>
                          <img
                            src={photo}
                            alt={name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                            onError={() => setFailedPhotos((prev) => ({ ...prev, [note.id]: true }))}
                          />
                        </div>
                      ) : (
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: "#1FD0EF", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#2D3852" }}>{(name || "?")[0]?.toUpperCase()}</span>
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#2D3852", margin: 0 }} className="truncate">{name}</p>
                        <p style={{ fontSize: 11, color: "#6E7892", margin: 0 }}>
                          {note.target_type === "startup" ? "Startup" : "Founder"} · {moment(note.createdat).format("MMM D, HH:mm")}
                        </p>
                      </div>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        padding: "3px 7px",
                        borderRadius: 6,
                        flexShrink: 0,
                        background: isTranscribed ? "#E5F8EE" : note.status === "failed" ? "#FEE2E2" : "#F2F8FA",
                        color: isTranscribed ? "#17875A" : note.status === "failed" ? "#DC2626" : "#6E7892",
                      }}>
                        {isTranscribed ? "Transcribed" : note.status === "failed" ? "Failed" : "Processing"}
                      </span>
                    </div>

                    {/* Duration */}
                    {note.duration_sec > 0 && (
                      <p style={{ fontSize: 11, color: "#6E7892", marginBottom: 6 }}>
                        {formatDuration(note.duration_sec)}
                      </p>
                    )}

                    {/* Audio player */}
                    {note.playback_url && (
                      <audio controls src={note.playback_url} className="w-full" style={{ borderRadius: 8 }} />
                    )}

                    {/* Transcript toggle */}
                    {note.transcript_text && (
                      <div style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          onClick={() => setOpenTranscripts((prev) => ({ ...prev, [note.id]: !prev[note.id] }))}
                          style={{
                            border: 0,
                            background: "transparent",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            cursor: "pointer",
                            color: "#0A859B",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: 0,
                          }}
                        >
                          Transcript
                          {transcriptOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                        <AnimatePresence initial={false}>
                          {transcriptOpen && (
                            <Motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden"
                            >
                              <p style={{
                                fontSize: 12,
                                color: "#4A5568",
                                lineHeight: 1.65,
                                marginTop: 6,
                                padding: "8px 10px",
                                borderRadius: 8,
                                background: "#F9FBFC",
                                border: "1px solid #E2E9EE",
                              }}>
                                {note.transcript_text}
                              </p>
                            </Motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
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
