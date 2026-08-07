import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Globe, Building2, Users, FileText } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { getCurrentUser, getStartupById, listPeople } from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";

const contactTypeColors = {
  experience_maker: "#1FD0EF",
  team: "#2D3852",
  vc: "#B9C1D4",
  alumni: "#FFB950",
  founder: "#4EA72E",
};

const contactTypeLabels = {
  experience_maker: "Experience Maker",
  team: "Decelera Team",
  vc: "VC",
  alumni: "Alumni",
  founder: "Founder",
};

function toExternalWebsiteUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withoutLeadingSlashes = trimmed.replace(/^\/+/, "");
  if (/^https?:\/\//i.test(withoutLeadingSlashes)) return withoutLeadingSlashes;
  return `https://${withoutLeadingSlashes}`;
}

export default function StartupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [startup, setStartup] = useState(null);
  const [founders, setFounders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [startupLogoFailed, setStartupLogoFailed] = useState(false);
  const [logoOpen, setLogoOpen] = useState(false);

  useEffect(() => {
    if (!logoOpen) return;
    const handler = (e) => { if (e.key === "Escape") setLogoOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [logoOpen]);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      setLoading(true);
      const me = await getCurrentUser();
      if (cancelled) return;
      setUser(me);
      if (!me) {
        setLoading(false);
        return;
      }

      const [s, people] = await Promise.all([getStartupById(id), listPeople()]);
      if (cancelled) return;
      setStartup(s || null);

      if (!s) {
        setFounders([]);
        setLoading(false);
        return;
      }

      const startupId = String(s.id || "").trim().toLowerCase();
      const linkedPeople = people
        .filter((person) => {
          const personStartupId = String(
            person.startup_id ||
            person.startupId ||
            person.startup?.id ||
            "",
          ).trim().toLowerCase();
          return personStartupId && personStartupId === startupId;
        })
        .sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
      setFounders(linkedPeople);

      setLoading(false);
    }
    fetch();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!loading && !user) return <UserNotRegisteredError />;

  if (loading) {
    return <LoadingState message="Preparing your day" />;
  }

  if (!startup) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh px-5">
        <p className="text-4xl mb-4">🚀</p>
        <p className="text-muted-foreground">Startup not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-primary text-sm font-medium">
          Go Back
        </button>
      </div>
    );
  }

  const startupWebsiteHref = toExternalWebsiteUrl(startup.website_url);

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA", minHeight: "100vh" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 18,
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
            marginBottom: 14,
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="relative flex items-center gap-4"
          >
            <div className="min-w-0">
              <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 30, color: "#2D3852", lineHeight: 1.1 }}>
                {startup.name}
              </h1>
              {startupWebsiteHref ? (
                <div className="inline-flex items-center gap-2 mt-2">
                  <span className="text-xs font-semibold" style={{ color: "#2D3852" }}>Website</span>
                  <a
                    href={startupWebsiteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Startup website"
                    title={startup.website_url || "Website"}
                    style={{ color: "#2D3852", display: "inline-flex", alignItems: "center", marginLeft: 8, opacity: 1 }}
                  >
                    <Globe size={15} />
                  </a>
                </div>
              ) : null}
            </div>
            {startup.logo_url && !startupLogoFailed ? (
              <div
                className="w-[88px] h-[88px] min-w-[88px] min-h-[88px] aspect-square flex-none rounded-full overflow-hidden shadow-sm bg-white border border-[#E2E7ED] cursor-pointer"
                style={{ marginLeft: "auto", marginRight: 16, backgroundColor: "white", padding: 6 }}
                onClick={() => setLogoOpen(true)}
              >
                <img
                  src={startup.logo_url}
                  alt={startup.name}
                  referrerPolicy="no-referrer"
                  onError={() => setStartupLogoFailed(true)}
                  className="w-full h-full object-contain"
                />
              </div>
            ) : (
              <div className="w-[88px] h-[88px] min-w-[88px] min-h-[88px] aspect-square flex-none rounded-full bg-white border border-[#E2E7ED] flex items-center justify-center text-[#2D3852] text-2xl font-bold" style={{ marginLeft: "auto", marginRight: 16 }}>
                {startup.name[0]}
              </div>
            )}
          </Motion.div>
          {startup.description ? (
            <p className="text-sm leading-relaxed mt-3" style={{ color: "#2D3852", opacity: 0.9, paddingRight: 12 }}>
              {startup.description}
            </p>
          ) : null}
          {(startup.stage || startup.founded_year) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {startup.stage && (
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#1FD0EF",
                  background: "rgba(31, 208, 239, 0.12)", borderRadius: 999,
                  padding: "3px 10px", letterSpacing: "0.06em", textTransform: "uppercase",
                  lineHeight: 1.3,
                }}>
                  {startup.stage}
                </span>
              )}
              {startup.founded_year && (
                <span style={{
                  fontSize: 10, fontWeight: 500, color: "#6E7892",
                  background: "rgba(45,56,82,0.12)", borderRadius: 999,
                  padding: "3px 10px", lineHeight: 1.3,
                }}>
                  {startup.founded_year}
                </span>
              )}
            </div>
          )}
        </div>

        <Motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative"
        >
          <div className="person-detail-sections">
            {startup.sector ? (
              <div className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
                <div className="flex items-center gap-[10px] mb-[12px]">
                  <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center" style={{ background: "#1FD0EF" }}>
                    <Building2 className="h-4 w-4" color="#2D3852" />
                  </div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Industry</p>
                </div>
                <div className="rounded-[14px] px-[14px] py-[12px]" style={{ background: "#F2F8FA", display: "flex", flexDirection: "column", gap: 8 }}>
                  {startup.sector.split(",").map((s, i) => {
                    const sectorColors = ["#1FD0EF", "#FFB950", "#4EA72E", "#B9C1D4", "#2D3852", "#FF7A6B"];
                    return (
                      <div key={i} className="flex items-center gap-[10px]">
                        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "9999px", backgroundColor: sectorColors[i % sectorColors.length], flex: "0 0 auto" }} />
                        <span style={{ fontSize: "12.5px", color: "#2D3852", fontWeight: 500 }}>{s.trim()}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

{founders.length > 0 && (
              <div className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
                <div className="flex items-center gap-[10px] mb-[12px]">
                  <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center" style={{ background: "#1FD0EF" }}>
                    <Users className="h-4 w-4" color="#2D3852" />
                  </div>
                  <div>
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>{founders.length === 1 ? "Founder" : "Founders"}</p>
                  </div>
                </div>
                <div className="card-list">
                  {founders.map((founder, index) => (
                    <Motion.div
                      key={founder.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.03 }}
                    >
                      <Link
                        to={`/person/${founder.id}`}
                        className="rounded-[16px] px-[12px] py-[11px] flex items-center gap-[10px] transition-all duration-200 hover:-translate-y-[1px]"
                        style={{ background: "#F2F8FA" }}
                      >
                        {founder.photo_url ? (
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              minWidth: 44,
                              minHeight: 44,
                              borderRadius: 12,
                              overflow: "hidden",
                              flexShrink: 0,
                              background: "#FFFFFF",
                              border: "1px solid #E2E7ED",
                            }}
                          >
                            <img
                              src={founder.photo_url}
                              alt={founder.full_name}
                              referrerPolicy="no-referrer"
                              style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                            />
                          </div>
                        ) : (
                          <div
                            className="bg-[#DDE4EB] flex items-center justify-center text-[#2D3852] font-bold text-sm"
                            style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, flexShrink: 0 }}
                          >
                            {(founder.full_name || "?").charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1" style={{ transform: "translateY(-3px)" }}>
                          <p className="text-[13px] font-semibold truncate" style={{ color: "#2D3852", lineHeight: 1.1 }}>
                            {founder.full_name}
                          </p>
                          <div className="flex items-center gap-[8px]" style={{ marginTop: -2 }}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 7,
                                height: 7,
                                borderRadius: "9999px",
                                backgroundColor:
                                  contactTypeColors[String(founder.contact_type || founder.person_type || "").trim().toLowerCase()] || "#B9C1D4",
                                flex: "0 0 auto",
                                transform: "translateY(-2px)",
                              }}
                            />
                            <span className="text-[11px] truncate" style={{ color: "#6E7892", transform: "translateY(-1px)", display: "inline-block", lineHeight: 1.1 }}>
                              {contactTypeLabels[String(founder.contact_type || founder.person_type || "").trim().toLowerCase()] ||
                                founder.contact_type ||
                                founder.person_type ||
                                "Attendee"}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </Motion.div>
                  ))}
                </div>
              </div>
            )}

            {startup.one_pager_url && (user?.contact_type === "experience_maker" || user?.contact_type === "team" || user?.contact_type === "vc") && (
              <div className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]" style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}>
                <div className="flex items-center gap-[10px] mb-[12px]">
                  <div className="w-[34px] h-[34px] rounded-full flex items-center justify-center" style={{ background: "#1FD0EF" }}>
                    <FileText className="h-4 w-4" color="#2D3852" />
                  </div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Documents</p>
                </div>
                <a
                  href={startup.one_pager_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-[14px] px-[14px] py-[12px] flex items-center gap-[10px] transition-all duration-200 hover:-translate-y-[1px] active:opacity-70"
                  style={{ background: "#F2F8FA", textDecoration: "none", display: "flex" }}
                >
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(31,208,239,0.12)" }}
                  >
                    <FileText size={18} color="#1FD0EF" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p style={{ fontSize: "13px", fontWeight: 600, color: "#2D3852", lineHeight: 1.2 }}>One Pager</p>
                    <p style={{ fontSize: "11px", color: "#6E7892", marginTop: 2 }}>Tap to open PDF</p>
                  </div>
                  <Globe size={14} color="#B9C1D4" style={{ flexShrink: 0 }} />
                </a>
              </div>
            )}
          </div>
        </Motion.div>
        <div className="h-8" />
      </div>

      {logoOpen && startup.logo_url && !startupLogoFailed && (
        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setLogoOpen(false)}
        >
          <Motion.img
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            src={startup.logo_url}
            alt={startup.name}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "88vw",
              maxHeight: "82vh",
              borderRadius: 20,
              objectFit: "contain",
              boxShadow: "0 12px 60px rgba(0,0,0,0.6)",
            }}
          />
        </Motion.div>
      )}
    </div>
  );
}

