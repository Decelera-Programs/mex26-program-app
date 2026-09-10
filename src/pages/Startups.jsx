import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { motion as Motion } from "framer-motion";
import { getCurrentUser, listStartups } from "../api/dataService";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from "../components/LoadingState";

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
              Startups
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>
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
          <div className="text-center py-16 text-muted-foreground text-sm">No startups found</div>
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

function StartupCard({ startup, index, failedLogos, setFailedLogos }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, delay: Math.min(index, 12) * 0.035, ease: [0.23, 1, 0.32, 1] }}
    >
      <Link to={`/startup/${startup.id}`} className="block">
        <div className="app-card-interactive person-card">
          <div className="flex items-center gap-[14px]">
            {startup.logo_url && !failedLogos[startup.id] ? (
              <div
                className="flex-shrink-0 bg-white border border-[#E2E7ED]"
                style={{ width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: 12, padding: 4, overflow: "hidden" }}
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
                className="flex items-center justify-center text-[#2D3852] font-bold text-lg flex-shrink-0"
                style={{ width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: 12, background: "#DDE4EB" }}
              >
                {startup.name[0]}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-foreground text-sm" style={{ margin: 0 }}>{startup.name}</p>
              {startup.sector && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 1 }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 9999, backgroundColor: "#1FD0EF", flex: "0 0 auto" }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#2D3852" }}>{startup.sector}</span>
                </div>
              )}
            </div>
          </div>

          {startup.tagline && (
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 10, lineHeight: 1.45 }}>
              {startup.tagline}
            </p>
          )}

          {(startup.stage || startup.founded_year) && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: startup.tagline ? 8 : 10 }}>
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
                  background: "#EEF2F5", borderRadius: 999,
                  padding: "3px 10px", lineHeight: 1.3,
                }}>
                  {startup.founded_year}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
    </Motion.div>
  );
}
