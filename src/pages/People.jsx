import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { getCurrentUser, listPeople } from "../api/dataService";
import PersonCard from "../components/PersonCard";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from '../components/LoadingState'

const TABS = [
  { key: "all", label: "All", color: "#2D3852" },
  { key: "experience_maker", label: "Exp. Makers", color: "#1FD0EF" },
  { key: "founder", label: "Founders", color: "#FFB950" },
  { key: "vc", label: "VCs", color: "#2D3852" },
  { key: "team", label: "Team", color: "#B9C1D4" },
];

export default function People() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [todayOnly, setTodayOnly] = useState(location.state?.todayOnly ?? false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetch() {
      setLoading(true);
      const me = await getCurrentUser();
      if (cancelled) return;
      setUser(me);
      const data = await listPeople();
      if (cancelled) return;
      setPeople(data);
      setLoading(false);
    }
    fetch();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
    return people.filter((p) => {
      const matchTab = activeTab === "all" || p.contact_type === activeTab;
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        p.full_name?.toLowerCase().includes(q) ||
        p.company?.toLowerCase().includes(q) ||
        p.title?.toLowerCase().includes(q) ||
        p.startup?.name?.toLowerCase().includes(q) ||
        (Array.isArray(p.expertise_tags) && p.expertise_tags.some((tag) => String(tag).toLowerCase().includes(q)));
      const matchToday =
        !todayOnly ||
        (p.arrival_date &&
          p.departure_date &&
          p.arrival_date.slice(0, 10) <= todayStr &&
          p.departure_date.slice(0, 10) >= todayStr);
      return matchTab && matchSearch && matchToday;
    });
  }, [people, activeTab, search, todayOnly]);

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
              People
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>Everyone at Menorca 2026</p>
          </Motion.div>
        </div>

        <div className="relative list-filter-search people-search-block w-full max-w-full overflow-hidden box-border">
          <Search className="list-search-icon absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name or company..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="app-input list-search-input pr-4 w-full max-w-full box-border"
          />
        </div>

        <label className="flex items-center pl-4 cursor-pointer select-none" style={{ marginBottom: 20, gap: 20 }}>
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
            className="hidden"
          />
          <span
            style={{
              width: 15,
              height: 15,
              borderRadius: 4,
              border: todayOnly ? "none" : "1.5px solid #B0BAD0",
              background: todayOnly ? "#2D3852" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            {todayOnly && (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 500, color: "#2D3852", marginLeft: 1.5 }}>Today in the island</span>
        </label>

        <div className="people-filter-tabs flex overflow-x-auto pb-3 pl-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-shrink-0 rounded-full font-semibold transition-all ${
                activeTab === tab.key ? "text-white" : "app-card text-muted-foreground"
              }`}
              style={
                activeTab === tab.key
                  ? { background: tab.color, color: "#FFFFFF", marginRight: 6, padding: "6px 13px", fontSize: 11.5, border: "1px solid transparent" }
                  : { marginRight: 6, padding: "6px 13px", fontSize: 11.5, border: `1px solid ${tab.color}55`, background: `${tab.color}12` }
              }
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingState message="Connecting with People" />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">No people found</div>
        ) : (
          <div className="card-list">
            {filtered.map((person, i) => (
              <PersonCard key={person.id} person={person} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

