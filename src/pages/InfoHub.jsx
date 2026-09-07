import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { Rocket, Users, MapPin, Palette, ArrowRight } from "lucide-react";
import { getCurrentUser } from "../api/dataService";

const MAPS_URL = "https://maps.app.goo.gl/SX1QnkxGqsaV1qu8A";


const tiles = [
  { to: "/startups",  title: "Startups",  eyebrow: "Cohort companies",  Icon: Rocket,  variant: "cyan"  },
  { to: "/people",    title: "People",    eyebrow: "EMs, VCs & team",    Icon: Users,   variant: "navy"  },
  { to: "/media-kit", title: "Moments",   eyebrow: "Photos & Stories",   Icon: Palette, variant: "white" },
  { to: "/logistics", title: "Logistics", eyebrow: "Venue & transport",  Icon: MapPin,  variant: "cream" },
];

const VARIANTS = {
  cyan:  { bg: "#1FD0EF", color: "#2D3852", iconBg: "rgba(45,56,82,0.12)",    eyebrow: "rgba(45,56,82,0.65)" },
  navy:  { bg: "#2D3852", color: "#FFFFFF", iconBg: "rgba(255,255,255,0.12)", eyebrow: "#1FD0EF"             },
  white: { bg: "#FFFFFF", color: "#2D3852", iconBg: "#F2F8FA",                eyebrow: "#9AA3B8"             },
  cream: { bg: "#FAF3DC", color: "#2D3852", iconBg: "rgba(45,56,82,0.06)",    eyebrow: "rgba(45,56,82,0.55)" },
};

export default function InfoHub() {
  const [isTeam, setIsTeam] = useState(false);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u?.contact_type === "team") setIsTeam(true);
    }).catch(() => {});
  }, []);

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
            marginBottom: 16,
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Info
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>México 2026</p>
          </Motion.div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {tiles.map(({ to, title, eyebrow, Icon, variant }, i) => {
            const s = VARIANTS[variant];
            return (
              <Motion.div
                key={to}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  to={to}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    background: s.bg,
                    color: s.color,
                    borderRadius: 20,
                    padding: 18,
                    minHeight: 160,
                    textDecoration: "none",
                    overflow: "hidden",
                    transition: "transform 160ms cubic-bezier(.16,1,.3,1)",
                  }}
                  onTouchStart={e => e.currentTarget.style.transform = "scale(0.97)"}
                  onTouchEnd={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: s.iconBg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <Icon size={18} color={s.color} strokeWidth={1.8} />
                  </div>

                  <div>
                    <div
                      style={{
                        fontFamily: "Taviraj, serif",
                        fontWeight: 300,
                        fontSize: 28,
                        lineHeight: 1,
                        marginTop: 16,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginTop: 14,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 600,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          color: s.eyebrow,
                        }}
                      >
                        {eyebrow}
                      </span>
                      <ArrowRight size={16} color={s.color} strokeWidth={1.8} />
                    </div>
                  </div>
                </Link>
              </Motion.div>
            );
          })}
        </div>

        {/* Location card */}
        {/* TODO: replace venue details (name, address, map) with the Decelera México 2026 home base. */}
        <Motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22 }}
          style={{
            background: "#FFFFFF",
            borderRadius: 20,
            padding: 18,
            marginTop: 12,
            boxShadow: "0 2px 12px rgba(45,56,82,0.06)",
          }}
        >
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "#1FD0EF", marginBottom: 12 }}>
            Decelera Home Base
          </p>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{
              width: 36, height: 36, borderRadius: "50%", background: "#F2F8FA",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <MapPin size={18} color="#1FD0EF" strokeWidth={1.8} />
            </div>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#2D3852", margin: 0 }}>
                Hotel Son Parc Beach Club Menorca
              </p>
              <p style={{ fontSize: 12, color: "#6E7892", marginTop: 3 }}>
                Av. de la Playa, H2 · Son Parc
              </p>
            </div>
          </div>
          <div style={{ marginTop: 14, borderRadius: 12, overflow: "hidden", height: 160, position: "relative" }}>
            <iframe
              title="Hotel Son Parc Beach Club Menorca"
              src="https://www.google.com/maps?q=Hotel+Son+Parc+Beach+Club,Son+Parc,Menorca&output=embed"
              width="100%"
              height="190"
              style={{ border: 0, display: "block", marginTop: -1 }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <a
              href={MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "#2D3852",
                background: "#F2F8FA",
                borderRadius: 999,
                padding: "7px 14px",
                textDecoration: "none",
              }}
            >
              <ArrowRight size={14} strokeWidth={2} />
              Open in Maps
            </a>
          </div>
        </Motion.div>

        {/* Privacy policy card */}
        <Motion.a
          href="https://www.decelera.ventures/privacy-policy"
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28 }}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#FFFFFF",
            borderRadius: 20,
            padding: "14px 18px",
            marginTop: 12,
            boxShadow: "0 2px 12px rgba(45,56,82,0.06)",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: "#6E7892" }}>Privacy Policy</span>
          <ArrowRight size={16} color="#9AA3B8" strokeWidth={1.8} />
        </Motion.a>

        {isTeam && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.34 }}
            style={{ display: "flex", justifyContent: "center", marginTop: 16 }}
          >
            <Link
              to="/team-notes"
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "#B9C1D4",
                textDecoration: "none",
                padding: "4px 10px",
              }}
            >
              Decelera
            </Link>
          </Motion.div>
        )}

      </div>
    </div>
  );
}
