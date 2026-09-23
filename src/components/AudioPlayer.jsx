import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

// Brand-styled stand-in for the native <audio controls> element, which can't
// be restyled and always looks out of place next to the rest of the app.
// Same recipe as the old Home daily-podcast player: navy play/pause circle,
// cyan progress fill, tabular time readout.
export default function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
  }

  function handleSeek(e) {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * duration;
  }

  function formatTime(sec) {
    const safe = Math.max(0, Number(sec) || 0);
    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
        style={{
          width: 32,
          height: 32,
          borderRadius: 9999,
          border: "none",
          flexShrink: 0,
          background: "#2D3852",
          color: "#FFFFFF",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        {playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 1 }} />}
      </button>
      <div
        role="slider"
        aria-label="Progress"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        onClick={handleSeek}
        style={{
          flex: 1,
          height: 4,
          borderRadius: 9999,
          background: "#EEF2F5",
          position: "relative",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${progress}%`,
            borderRadius: 9999,
            background: "#1FD0EF",
            transition: "width 0.1s linear",
          }}
        />
      </div>
      <span style={{ fontSize: 10.5, color: "#6E7892", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
    </div>
  );
}
