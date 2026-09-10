import { useEffect, useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { useLocation } from "react-router-dom";
import { getCurrentUser, listPeople } from "../api/dataService";
import { PROGRAM_TIMEZONE } from "../lib/dateTime";
import PersonCard from "../components/PersonCard";
import UserNotRegisteredError from "./UserNotRegisteredError";
import LoadingState from '../components/LoadingState'
import EmptyState from "../components/EmptyState";

const TABS = [
  { key: "all", label: "All" },
  { key: "experience_maker", label: "Exp. Makers" },
  { key: "founder", label: "Founders" },
  { key: "vc", label: "Investors" },
  { key: "team", label: "Team" },
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
    const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: PROGRAM_TIMEZONE }).format(new Date());
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
              People
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 3 }}>Everyone at México 2026</p>
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

        <label className="flex items-center pl-4 cursor-pointer select-none" style={{ marginBottom: 18, gap: 9 }}>
          <input
            type="checkbox"
            checked={todayOnly}
            onChange={(e) => setTodayOnly(e.target.checked)}
            className="hidden"
          />
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 5,
              border: todayOnly ? "none" : "1.5px solid #B0BAD0",
              background: todayOnly ? "#2D3852" : "transparent",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.15s ease, border-color 0.15s ease",
            }}
          >
            {todayOnly && (
              <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#2D3852" }}>Here today</span>
        </label>

        <div className="people-filter-tabs flex overflow-x-auto pb-3 pl-4">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="press-scale flex-shrink-0 rounded-full font-semibold transition-colors duration-200"
                style={{
                  marginRight: 6,
                  padding: "6px 13px",
                  fontSize: 11.5,
                  border: "1px solid transparent",
                  background: active ? "#2D3852" : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#6E7892",
                  borderColor: active ? "transparent" : "#E4EAF0",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <LoadingState message="Connecting with People" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search || activeTab !== "all" || todayOnly ? "No one matches that" : "No people yet"}
            hint={
              search || activeTab !== "all" || todayOnly
                ? "Try a different search or filter."
                : "Attendees will appear here as they're added."
            }
          />
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

