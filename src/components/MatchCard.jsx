import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { motion as Motion } from "framer-motion";

const typeColors = {
  experience_maker: "#1FD0EF",
  team: "#B9C1D4",
  vc: "#2D3852",
  alumni: "#FFB950",
  founder: "#FFB950",
};

export default function MatchCard({ match, onClick }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!match?.counterpart) return null;

  const { counterpart, reason_text: reasonText, opener, role } = match;
  const normalizedContactType = String(counterpart.contact_type || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const accentColor = typeColors[normalizedContactType] || "#1FD0EF";
  const initials = (counterpart.full_name || "")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <Motion.button
      key="match-card"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-[20px] px-[18px] pt-[16px] pb-[14px] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.25)]"
      style={{ background: "#2D3852", border: "none" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-[10px]">
          <div
            className="w-[34px] h-[34px] rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: "#FFF6E5" }}
          >
            <Sparkles size={16} color="#B9812E" />
          </div>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#FFFFFF" }}>Today&apos;s match</p>
            <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.6)" }}>New connection suggested</p>
          </div>
        </div>
        <ChevronRight size={16} color="rgba(255,255,255,0.5)" />
      </div>

      <div
        style={{
          marginTop: 12,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {counterpart.photo_url && !imageFailed ? (
          <div
            className="overflow-hidden flex-shrink-0"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40, borderRadius: 10 }}
          >
            <img
              src={counterpart.photo_url}
              alt={counterpart.full_name}
              referrerPolicy="no-referrer"
              onError={() => setImageFailed(true)}
              className="object-cover"
              style={{ width: "100%", height: "100%", display: "block" }}
            />
          </div>
        ) : (
          <div
            className="flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
            style={{ width: 40, height: 40, minWidth: 40, minHeight: 40, borderRadius: 10, background: accentColor }}
          >
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF", margin: 0 }}>{counterpart.full_name}</p>
          {reasonText && (
            <p
              style={{
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                marginTop: 2,
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              {reasonText}
            </p>
          )}
          {role === "founder" && opener && (
            <p
              style={{
                fontSize: 11,
                fontStyle: "italic",
                color: "rgba(255,255,255,0.55)",
                marginTop: 6,
                paddingLeft: 8,
                borderLeft: "2px solid rgba(255,255,255,0.2)",
                overflow: "hidden",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
              }}
            >
              &ldquo;{opener}&rdquo;
            </p>
          )}
        </div>
      </div>
    </Motion.button>
  );
}
