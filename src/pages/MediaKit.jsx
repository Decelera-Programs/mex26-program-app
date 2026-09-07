import { useEffect, useState } from "react";
import { motion as Motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const DAY_META = [
  { day: 1, gradient: "linear-gradient(135deg, #3de8f0 0%, #22b4e8 100%)" },
  { day: 2, gradient: "linear-gradient(135deg, #f5a865 0%, #e07b3a 100%)" },
  { day: 3, gradient: "linear-gradient(135deg, #2d3354 0%, #1a1f3a 100%)" },
  { day: 4, gradient: "linear-gradient(135deg, #3de8f0 0%, #1abcd8 100%)" },
  { day: 5, gradient: "linear-gradient(135deg, #f5ede0 0%, #e8d8c0 100%)" },
  { day: 6, gradient: "linear-gradient(135deg, #8b5a3a 0%, #5c3520 100%)" },
  { day: 7, gradient: "linear-gradient(135deg, #2d3354 0%, #1a1f3a 100%)" },
];

function DayCard({ d, i }) {
  const hasPhoto = !!d.coverUrl;
  const textCol = hasPhoto ? "#ffffff" : "#ffffff";

  return (
    <Motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + i * 0.05 }}
      type="button"
      onClick={() => d.flickrAlbumUrl && window.open(d.flickrAlbumUrl, "_blank")}
      className="active:scale-[0.97] transition-transform"
      style={{
        borderRadius: 16,
        background: hasPhoto
          ? `url(${d.coverUrl}) center/cover no-repeat`
          : d.gradient,
        aspectRatio: "1 / 1",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 14,
        overflow: "hidden",
        position: "relative",
        border: "none",
        cursor: d.flickrAlbumUrl ? "pointer" : "default",
      }}
    >
      {hasPhoto && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.50) 100%)",
          }}
        />
      )}

      {/* top */}
      <p style={{ fontFamily: "Taviraj, serif", fontWeight: 400, fontSize: 26, color: textCol, margin: 0, lineHeight: 1, position: "relative", alignSelf: "flex-start" }}>
        Day {d.day}
      </p>

      {/* bottom */}
      <div style={{ display: "flex", justifyContent: "flex-end", position: "relative" }}>
        <ChevronRight style={{ width: 15, height: 15, color: "rgba(255,255,255,0.75)", flexShrink: 0 }} />
      </div>
    </Motion.button>
  );
}

export default function MediaKit() {
  const [days, setDays] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("home_daily_content")
      .select("date, media_album_url, media_cover_url")
      .order("date", { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return;
        const startDate = new Date(data[0].date);
        const merged = data
          .map((row) => {
            const dayNum = Math.round((new Date(row.date) - startDate) / 86_400_000) + 1;
            const meta = DAY_META.find((m) => m.day === dayNum);
            if (!meta) return null;
            return {
              ...meta,
              flickrAlbumUrl: row.media_album_url ?? null,
              coverUrl: row.media_cover_url ?? null,
            };
          })
          .filter(Boolean);
        setDays(merged);
      });
  }, []);

  const visibleDays = days.filter((d) => d.flickrAlbumUrl);

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

        {/* Header card */}
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 22,
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
            marginBottom: 16,
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Moments
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Photos &amp; Stories</p>
            <p style={{ fontSize: 13, color: "#2D3852", opacity: 0.75, marginTop: 10, lineHeight: 1.55 }}>
              We'd love to see you sharing your Decelera moments on Social Media! There is a picture library updated every day, feel free to pick the ones you like the most. One little thing, please don't forget to mention <b>@Decelera</b> and use the hashtag <b>#DeceleraMexico2026</b> in all your posts!
            </p>
          </Motion.div>
        </div>

        {/* Photo album section */}
        {visibleDays.length > 0 && (
          <>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#6E7892", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 12 }}>
              Photo album · By day
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {visibleDays.map((d, i) => (
                <DayCard key={d.day} d={d} i={i} />
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
