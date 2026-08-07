import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Globe, Calendar, GraduationCap, Building2, ChevronRight, ChevronDown, Target } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { getCurrentUser, getPersonById, getStartupById } from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";

const typeLabels = {
  experience_maker: "Experience Maker",
  team: "Decelera Team",
  vc: "VC / Investor",
  alumni: "Alumni",
  founder: "Founder",
};

export default function PersonDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [person, setPerson] = useState(null);
  const [startup, setStartup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [imageFailed, setImageFailed] = useState(false);
  const [startupLogoFailed, setStartupLogoFailed] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [calendlyOpen, setCalendlyOpen] = useState(false);

  useEffect(() => {
    if (!photoOpen) return;
    const handler = (e) => { if (e.key === "Escape") setPhotoOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [photoOpen]);

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

      const found = await getPersonById(id);
      if (cancelled) return;
      setPerson(found || null);

      if (found?.startup_id) {
        const s = await getStartupById(found.startup_id);
        if (cancelled) return;
        setStartup(s || null);
      } else {
        setStartup(null);
      }

      setLoading(false);
    }
    fetch();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!loading && !user) return <UserNotRegisteredError />;

  if (loading) {
    return <LoadingState />;
  }

  if (!person) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh px-5">
        <p className="text-4xl mb-4">👤</p>
        <p className="text-muted-foreground">Person not found</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-primary text-sm font-medium">
          Go Back
        </button>
      </div>
    );
  }

  const contactType = person.contact_type || person.person_type || "";
  const linkedinUrl = person.linkedin_url || "";
  const aboutText =
    person.bio ||
    person.about ||
    person.description ||
    "";
  const initials = person.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const detailCardClass =
    "rounded-[20px] border bg-card px-6 py-6 shadow-[0_10px_28px_rgba(15,23,42,0.08)]";
  const expertiseDotColors = ["#1FD0EF", "#B9C1D4", "#4EA72E", "#FFB950"];

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
            <div className="min-w-0" style={{ maxWidth: 210 }}>
              <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 30, color: "#2D3852", lineHeight: 1.1 }}>
                {person.full_name}
              </h1>
              {contactType || linkedinUrl ? (
                <div className="inline-flex items-baseline gap-2 mt-2">
                  {contactType ? (
                    <span
                      className="person-detail-contact-type-tag inline-flex px-4 py-1.5 rounded-full text-xs font-semibold"
                      style={{ border: "none", background: "transparent", color: "#2D3852" }}
                    >
                      {typeLabels[contactType] || contactType}
                    </span>
                  ) : null}
                  {linkedinUrl ? (
                    <a
                      href={linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="LinkedIn"
                      title="LinkedIn"
                      style={{ color: "#2D3852", display: "inline-flex", alignItems: "center", marginLeft: 10, opacity: 1 }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        xmlns="http://www.w3.org/2000/svg"
                        style={{ width: 16, height: 16, display: "block", fill: "currentColor", transform: "translateY(3px)" }}
                      >
                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                      </svg>
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            {person.photo_url && !imageFailed ? (
              <div
                className="w-[88px] h-[88px] min-w-[88px] min-h-[88px] aspect-square flex-none rounded-full overflow-hidden shadow-sm bg-white border border-[#E2E7ED] cursor-pointer"
                style={{ marginLeft: "auto", marginRight: 16 }}
                onClick={() => setPhotoOpen(true)}
              >
                <img
                  src={person.photo_url}
                  alt={person.full_name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-[88px] h-[88px] min-w-[88px] min-h-[88px] aspect-square flex-none rounded-full bg-white border border-[#E2E7ED] flex items-center justify-center text-[#2D3852] text-2xl font-bold" style={{ marginLeft: "auto", marginRight: 16 }}>
                {initials}
              </div>
            )}
          </Motion.div>
          {aboutText ? (
            <p className="text-sm leading-relaxed mt-3" style={{ color: "#2D3852", opacity: 0.9, paddingRight: 12 }}>
              {aboutText}
            </p>
          ) : null}
          {person.fun_fact ? (
            <p className="text-sm leading-relaxed mt-2" style={{ color: "#2D3852", opacity: 0.75, paddingRight: 12 }}>
              <span style={{ fontWeight: 600 }}>Fun fact:</span> {person.fun_fact}
            </p>
          ) : null}
        </div>

        <Motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative"
        >
          <div className="person-detail-sections">
          {(person.twitter_url || person.website_url) && (
            <div className="rounded-[20px] border p-5 shadow-[0_8px_20px_rgba(15,23,42,0.06)] flex flex-wrap gap-2" style={{ borderColor: "#EEF2F5", background: "#FFFFFF" }}>
              {person.twitter_url && (
                <a
                  href={person.twitter_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-3 py-2 rounded-xl"
                >
                  X / Twitter
                </a>
              )}
              {person.website_url && (
                <a
                  href={person.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted px-3 py-2 rounded-xl"
                >
                  <Globe className="h-3.5 w-3.5" /> Website
                </a>
              )}
            </div>
          )}

          {person.expertise_tags?.length > 0 && (
            <div className="card-list">
              <div
                className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]"
                style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
              >
                <div className="flex items-center gap-[10px] mb-[12px]">
                  <div
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                    style={{ background: "#1FD0EF" }}
                  >
                    <GraduationCap className="h-4 w-4" color="#2D3852" />
                  </div>
                  <div>
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Expertise</p>
                  </div>
                </div>

                <div className="rounded-[14px] px-[14px] py-[12px]" style={{ background: "#F2F8FA" }}>
                  <div className="flex flex-col gap-[8px]">
                    {person.expertise_tags.map((tag, index) => (
                      <div
                        key={tag}
                        className="flex items-center gap-[10px]"
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: "9999px",
                            backgroundColor: expertiseDotColors[index % expertiseDotColors.length],
                            flex: "0 0 auto",
                          }}
                        />
                        <span style={{ fontSize: "12.5px", color: "#2D3852", fontWeight: 500 }}>{tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {person.id === "a682322f-e1c3-4283-9d35-93df7bee71ad" && (
            <div className="card-list">
              <div
                className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]"
                style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
              >
                <div
                  className="flex items-center gap-[10px] mb-[12px] cursor-pointer"
                  onClick={() => setCalendlyOpen((v) => !v)}
                >
                  <div
                    className="w-[34px] h-[34px] min-w-[34px] rounded-full flex items-center justify-center"
                    style={{ background: "#1FD0EF" }}
                  >
                    <Calendar className="h-4 w-4" color="#2D3852" />
                  </div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852", flex: 1 }}>Lean Coaching Session</p>
                  <ChevronDown
                    size={18}
                    color="#6E7892"
                    style={{ transition: "transform 0.2s", transform: calendlyOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                </div>
                {calendlyOpen && (
                  <div className="rounded-[14px] px-[14px] py-[12px]" style={{ background: "#F2F8FA" }}>
                    <p style={{ fontSize: "12.5px", color: "#2D3852", fontWeight: 400, lineHeight: 1.65, whiteSpace: "pre-line" }}>
                      {"A 20 min. lean coaching session is included onsite during the program. The aim is to provide you support to deal with your most pressing human challenge:\n\n1. Individual skills to manage stress\n2. Productivity\n3. Leadership\n4. Interpersonal skills\n\nWe will follow a structured process to clarify your most pressing human-factor challenge, explore alternative scenarios, co-create potential solutions, and define a clear call to action."}
                    </p>
                    <a
                      href="https://calendly.com/miguel-quintana2012/20min"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full rounded-[14px] py-3 text-sm font-semibold"
                      style={{ marginTop: 14, background: "#1FD0EF", color: "#2D3852" }}
                    >
                      Book on Calendly
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {startup && (
            <div className="card-list">
              <Link
                to={`/startup/${startup.id}`}
                className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px] block transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_10px_28px_rgba(45,56,82,0.08)]"
                style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
              >
                <div className="flex items-center justify-between mb-[12px]">
                  <div className="flex items-center gap-[10px] min-w-0">
                    <div
                      className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                      style={{ background: "#1FD0EF" }}
                    >
                      <Building2 className="h-4 w-4" color="#2D3852" />
                    </div>
                    <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Startup</p>
                  </div>
                  <ChevronRight size={16} color="#6E7892" />
                </div>

                <div className="rounded-[14px] px-[12px] py-[11px] flex items-center gap-[10px]" style={{ background: "#F2F8FA" }}>
                  {startup.logo_url && !startupLogoFailed ? (
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
                        src={startup.logo_url}
                        alt={startup.name}
                        referrerPolicy="no-referrer"
                        onError={() => setStartupLogoFailed(true)}
                        style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
                      />
                    </div>
                  ) : (
                    <div
                      className="bg-[#DDE4EB] flex items-center justify-center text-[#2D3852] font-bold text-sm"
                      style={{ width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 12, flexShrink: 0 }}
                    >
                      {startup.name[0]}
                    </div>
                  )}
                  <div className="min-w-0 flex-1" style={{ transform: "translateY(-4px)" }}>
                    <p className="text-[13px] font-semibold truncate" style={{ color: "#2D3852", lineHeight: 1.1 }}>{startup.name}</p>
                    <div className="flex items-center gap-[8px]" style={{ marginTop: -2 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "9999px",
                          backgroundColor: "#1FD0EF",
                          flex: "0 0 auto",
                          transform: "translateY(-2px)",
                        }}
                      />
                      <span className="text-[11px] truncate" style={{ color: "#6E7892", transform: "translateY(-1px)", display: "inline-block", lineHeight: 1.1 }}>
                        {startup.sector || "Industry not specified"}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          )}

          {contactType === "experience_maker" && person.post_program_expectations && Object.values(person.post_program_expectations).some(Boolean) && !["98822c7b-1729-41b2-977f-fc26963da1e1", "e345249c-d7c5-41a1-9b8a-3ed05a2b0354"].includes(person.id) && (
            <div className="card-list">
              <div
                className="rounded-[20px] border px-[18px] pt-[16px] pb-[14px]"
                style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
              >
                <div className="flex items-center gap-[10px] mb-[12px]">
                  <div
                    className="w-[34px] h-[34px] rounded-full flex items-center justify-center"
                    style={{ background: "#1FD0EF" }}
                  >
                    <Target className="h-4 w-4" color="#2D3852" />
                  </div>
                  <p style={{ fontSize: "14px", fontWeight: 600, color: "#2D3852" }}>Post-program expectations</p>
                </div>
                <div className="rounded-[14px] px-[14px] py-[12px] flex flex-col gap-[8px]" style={{ background: "#F2F8FA" }}>
                  {[
                    { key: "open_to_advisor", label: "Open to be advisor" },
                    { key: "open_to_investor", label: "Open to invest" },
                  ].filter(({ key }) => person.post_program_expectations[key]).map(({ key, label }) => (
                    <div key={key} className="flex items-center gap-[10px]">
                      <span
                        aria-hidden="true"
                        style={{ width: 7, height: 7, borderRadius: "9999px", backgroundColor: "#1FD0EF", flex: "0 0 auto" }}
                      />
                      <span style={{ fontSize: "12.5px", color: "#2D3852", fontWeight: 500 }}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {person.availability_note && (
            <>
              <div className={`${detailCardClass} grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3`} style={{ borderColor: "#EEF2F5", background: "#FFFFFF" }}>
                <div className="pt-0.5 flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">1:1 Availability</p>
                  <p className="text-sm text-foreground">{person.availability_note}</p>
                </div>
              </div>
            </>
          )}
          </div>
        </Motion.div>
        <div className="h-8" />
      </div>

      {photoOpen && person.photo_url && !imageFailed && (
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
          onClick={() => setPhotoOpen(false)}
        >
          <Motion.img
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 28 }}
            src={person.photo_url}
            alt={person.full_name}
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

