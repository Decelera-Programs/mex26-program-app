import { useEffect, useMemo, useState } from "react";
import { Building2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { getCurrentUser, listStartups } from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";

export default function Startups() {
  const [user, setUser] = useState(null);
  const [startups, setStartups] = useState([]);
  const [failedLogos, setFailedLogos] = useState({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      setLoading(true);
      const me = await getCurrentUser();
      if (cancelled) return;
      setUser(me);
      const s = await listStartups();
      if (cancelled) return;
      setStartups(s);
      setLoading(false);
    }
    fetch();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return startups.filter(
      (s) =>
        !q ||
        s.name?.toLowerCase().includes(q) ||
        s.sector?.toLowerCase().includes(q) ||
        s.tagline?.toLowerCase().includes(q),
    );
  }, [startups, search]);

  if (!loading && !user) return <UserNotRegisteredError />;

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">

        <div
          style={{
            borderRadius: 20,
            padding: "20px 22px",
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 1px 3px rgba(45, 56, 82, 0.06)",
            marginBottom: 16,
          }}
        >
          <Motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 400, fontSize: 26, color: "#2D3852", margin: 0, letterSpacing: "-0.01em" }}>
              Startups
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 3 }}>
              {startups.length} companies at México 2026
            </p>
          </Motion.div>
        </div>

        <div className="relative list-filter-search people-search-block w-full max-w-full overflow-hidden box-border">
          <Search className="list-search-icon absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or sector..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="app-input list-search-input pr-4 w-full max-w-full box-border"
          />
        </div>

        {loading ? (
          <LoadingState message="Discovering Startups" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search ? "No companies match your search" : "No companies yet"}
            hint={search ? "Try a different name or sector." : "They'll show up here once they're added."}
          />
        ) : (
          <div className="card-list">
            {filtered.map((startup, i) => (
              <StartupCard
                key={startup.id}
                startup={startup}
                index={i}
                failedLogos={failedLogos}
                setFailedLogos={setFailedLogos}
              />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

// One quiet chip style for all startup metadata (stage, year) — same size,
// same weight, same colour, so the card reads as one thing.
const chipStyle = {
  fontSize: 10,
  fontWeight: 600,
  color: "#6E7892",
  background: "#F2F8FA",
  border: "1px solid #E4EAF0",
  borderRadius: 999,
  padding: "3px 9px",
  letterSpacing: "0.04em",
  lineHeight: 1.3,
};

function StartupCard({ startup, index, failedLogos, setFailedLogos }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.44, delay: Math.min(index, 10) * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={`/startup/${startup.id}`} className="block">
        <div className="app-card-interactive person-card">
          <div className="flex items-center gap-[13px]">
            {startup.logo_url && !failedLogos[startup.id] ? (
              <div
                className="flex-shrink-0 bg-white"
                style={{ width: 46, height: 46, minWidth: 46, borderRadius: 13, border: "1px solid #E4EAF0", padding: 5, overflow: "hidden" }}
              >
                <img
                  src={startup.logo_url}
                  alt={startup.name}
                  referrerPolicy="no-referrer"
                  onError={() => setFailedLogos((prev) => ({ ...prev, [startup.id]: true }))}
                  className="w-full h-full object-contain"
                  style={{ display: "block" }}
                />
              </div>
            ) : (
              <div
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 46, height: 46, minWidth: 46, borderRadius: 13, background: "#EEF2F5", color: "#2D3852", fontWeight: 700, fontSize: 17 }}
              >
                {(startup.name || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-foreground" style={{ margin: 0, fontSize: 14, lineHeight: 1.25 }}>
                {startup.name}
              </p>
              {startup.sector && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: "#1F9AAF", flex: "0 0 auto" }} />
                  <span
                    style={{
                      fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                      color: "#6E7892", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    {startup.sector}
                  </span>
                </div>
              )}
            </div>
          </div>

          {startup.tagline && (
            <p style={{ fontSize: 11.5, color: "#6E7892", marginTop: 10, lineHeight: 1.45 }}>
              {startup.tagline}
            </p>
          )}

          {(startup.stage || startup.founded_year) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: startup.tagline ? 9 : 10 }}>
              {startup.stage && (
                <span style={chipStyle}>{String(startup.stage).toUpperCase()}</span>
              )}
              {startup.founded_year && (
                <span style={chipStyle}>{startup.founded_year}</span>
              )}
            </div>
          )}
        </div>
      </Link>
    </Motion.div>
  );
}
