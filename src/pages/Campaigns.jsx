import { useEffect, useMemo, useState } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  Megaphone,
  Send,
  CalendarClock,
  FileEdit,
  Pencil,
  Trash2,
  X,
  RefreshCw,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import {
  createCampaign,
  deleteCampaign,
  listCampaigns,
  listEvents,
  listStartups,
  previewCampaignAudience,
  sendCampaignNow,
  updateCampaign,
} from "../api/dataService";
import DeceleraRosetteMark from "../components/DeceleraRosetteMark";
import EmptyState from "../components/EmptyState";
import LoadingState from "../components/LoadingState";
import { formatDayKey, formatShortDateTime, formatTime, getTodayKey, programNow, programWallClockToDate, toProgramWallClock } from "../lib/dateTime";
import { DUR, EASE, SPRING, stagger } from "../lib/motion";

const ADMIN_KEY_STORAGE = "decelera.campaigns.adminKey";

const CONTACT_TYPES = [
  { key: "experience_maker", label: "Exp. Makers" },
  { key: "founder", label: "Founders" },
  { key: "vc", label: "Investors" },
  { key: "team", label: "Team" },
  { key: "lp", label: "LP" },
];

const MODES = [
  { key: "draft", label: "Save as draft" },
  { key: "schedule", label: "Schedule" },
  { key: "send_now", label: "Send now" },
];

const STATUS_META = {
  draft: { label: "Draft", bg: "#EEF2F5", fg: "#6E7892" },
  scheduled: { label: "Scheduled", bg: "#E6F8FC", fg: "#0C7A90" },
  processing: { label: "Sending…", bg: "#FFF4E5", fg: "#FF9950" },
  sent: { label: "Sent", bg: "#2D3852", fg: "#FFFFFF" },
  failed: { label: "Failed", bg: "#FFF0F0", fg: "#D9534F" },
};

const emptyForm = {
  title: "",
  message: "",
  eventId: "",
  contactTypes: ["experience_maker"],
  startupIds: "",
  onIslandToday: false,
  mode: "draft",
  scheduledFor: "",
};

// The schedule input is always Mexico time, whatever the device timezone
// (campaigns are often prepared from Spain): show the stored instant as
// Mexico wall clock, and convert back to a real instant on save.
function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const wall = toProgramWallClock(iso);
  return typeof wall === "string" ? wall.slice(0, 16) : "";
}

function dayHeading(dayKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return "Unscheduled";
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const todayKey = getTodayKey();
  const tomorrow = programNow();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (dayKey === todayKey) return "Today";
  if (dayKey === formatDayKey(tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function describeAudience(filters) {
  const types = filters?.contact_types || [];
  const startupCount = (filters?.startup_ids || []).length;
  const parts = [];
  parts.push(
    types.length
      ? types.map((t) => CONTACT_TYPES.find((c) => c.key === t)?.label || t).join(", ")
      : "Everyone",
  );
  if (startupCount) parts.push(`${startupCount} startup${startupCount > 1 ? "s" : ""}`);
  if (filters?.on_island_today) parts.push("on-site today");
  return parts.join(" · ");
}

export default function Campaigns() {
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_KEY_STORAGE) || "";
    } catch {
      return "";
    }
  });
  const [showAdminKey, setShowAdminKey] = useState(false);

  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);

  const [events, setEvents] = useState([]);
  const [startups, setStartups] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [preview, setPreview] = useState(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    try {
      sessionStorage.setItem(ADMIN_KEY_STORAGE, adminKey);
    } catch {
      /* ignore */
    }
  }, [adminKey]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  async function loadCampaigns() {
    const data = await listCampaigns(adminKey);
    setCampaigns(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      try {
        const [ev, st] = await Promise.all([listEvents(), listStartups()]);
        if (cancelled) return;
        setEvents(ev);
        setStartups(st);
        await loadCampaigns();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load campaigns");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startupNameById = useMemo(() => {
    const map = new Map();
    startups.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [startups]);

  const grouped = useMemo(() => {
    const withDate = campaigns.map((c) => ({
      ...c,
      _displayAt: c.sent_at || c.scheduled_for || c.created_at,
    }));
    const byDay = new Map();
    withDate.forEach((c) => {
      const key = formatDayKey(c._displayAt) || "unscheduled";
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(c);
    });
    const days = Array.from(byDay.entries()).sort(([a], [b]) => a.localeCompare(b));
    days.forEach(([, items]) => {
      items.sort((a, b) => new Date(a._displayAt) - new Date(b._displayAt));
    });
    return days;
  }, [campaigns]);

  function updateForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function toggleContactType(key) {
    setForm((prev) => ({
      ...prev,
      contactTypes: prev.contactTypes.includes(key)
        ? prev.contactTypes.filter((v) => v !== key)
        : [...prev.contactTypes, key],
    }));
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setPreview(null);
  }

  function startEdit(campaign) {
    setEditingId(campaign.id);
    setForm({
      title: campaign.title || "",
      message: campaign.message || "",
      eventId: campaign.event_id || "",
      contactTypes: campaign.filters_json?.contact_types?.length
        ? campaign.filters_json.contact_types
        : ["experience_maker"],
      startupIds: (campaign.filters_json?.startup_ids || []).join(", "),
      onIslandToday: Boolean(campaign.filters_json?.on_island_today),
      mode: campaign.status === "scheduled" ? "schedule" : "draft",
      scheduledFor: toDatetimeLocalValue(campaign.scheduled_for),
    });
    setPreview(null);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filters = useMemo(
    () => ({
      contact_types: form.contactTypes,
      startup_ids: form.startupIds
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      on_island_today: form.onIslandToday,
    }),
    [form.contactTypes, form.startupIds, form.onIslandToday],
  );

  const unresolvedStartupNames = filters.startup_ids.map((id) => startupNameById.get(id) || id);

  async function handlePreview() {
    setError("");
    setBusy(true);
    try {
      const data = await previewCampaignAudience(filters, adminKey);
      setPreview(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not preview audience");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    if (!form.title.trim() || !form.message.trim()) {
      setError("Title and message are required.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const payload = {
        title: form.title.trim(),
        message: form.message.trim(),
        event_id: form.eventId || null,
        filters,
        mode: form.mode,
        scheduled_for: form.mode === "schedule" && form.scheduledFor ? programWallClockToDate(form.scheduledFor)?.toISOString() ?? null : null,
      };
      if (editingId) {
        await updateCampaign(editingId, payload, adminKey);
        setNotice("Notification updated.");
      } else {
        await createCampaign(payload, adminKey);
        setNotice(form.mode === "send_now" ? "Notification sent." : "Notification saved.");
      }
      await loadCampaigns();
      resetForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save notification");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendNow(campaignId) {
    setError("");
    setBusy(true);
    try {
      await sendCampaignNow(campaignId, adminKey);
      await loadCampaigns();
      setNotice("Notification sent.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dispatch notification");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(campaign) {
    if (!window.confirm(`Delete "${campaign.title}"? This can't be undone.`)) return;
    setError("");
    setBusy(true);
    try {
      await deleteCampaign(campaign.id, adminKey);
      await loadCampaigns();
      if (editingId === campaign.id) resetForm();
      setNotice("Notification deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete notification");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto">
        {/* Hero */}
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 22,
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
            marginBottom: 18,
          }}
        >
          <div
            className="decelera-mx-mark pointer-events-none absolute"
            style={{ right: -56, bottom: -56, height: 210, width: 210, color: "#2D3852" }}
          >
            <DeceleraRosetteMark />
          </div>
          <Motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.base, ease: EASE.out }}
            className="relative flex items-center justify-between gap-4"
          >
            <div>
              <div className="flex items-center gap-2">
                <Megaphone size={18} color="#2D3852" strokeWidth={1.8} />
                <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 26, color: "#2D3852", margin: 0 }}>
                  Push notifications
                </h1>
              </div>
              <p style={{ fontSize: 12, color: "#6E7892", marginTop: 4 }}>
                Internal tool for grouped notifications to the app.
              </p>
            </div>
          </Motion.div>

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(45,56,82,0.10)" }}>
            <button
              type="button"
              onClick={() => setShowAdminKey((v) => !v)}
              style={{ fontSize: 10.5, color: "#6E7892", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "Fustat, sans-serif" }}
            >
              {showAdminKey ? "Hide admin key" : adminKey ? "Admin key set · change" : "Not on the allowlist? Set an admin key"}
            </button>
            {showAdminKey && (
              <input
                className="app-input"
                style={{ marginTop: 8 }}
                type="password"
                placeholder="x-admin-key"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                autoComplete="off"
              />
            )}
          </div>
        </div>

        {notice && (
          <Motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[20px] mb-3"
            style={{ background: "#2D3852", padding: "10px 16px" }}
          >
            <p style={{ fontSize: 11.5, color: "#FFFFFF", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles size={12} color="#1FD0EF" /> {notice}
            </p>
          </Motion.div>
        )}

        {/* Form */}
        <div
          className="rounded-[20px] border"
          style={{ background: "#FFFFFF", borderColor: "#EEF2F5", padding: 18, marginBottom: 22 }}
        >
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#2D3852", fontFamily: "Fustat, sans-serif" }}>
              {editingId ? "Edit notification" : "New notification"}
            </p>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="press-scale"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#6E7892", background: "#F2F8FA", border: "none", borderRadius: 20, padding: "5px 10px", cursor: "pointer" }}
              >
                <X size={11} /> Cancel edit
              </button>
            )}
          </div>

          <div className="flex flex-col" style={{ gap: 10 }}>
            <input
              className="app-input"
              placeholder="Title"
              value={form.title}
              onChange={(e) => updateForm({ title: e.target.value })}
            />
            <textarea
              className="app-input"
              style={{ minHeight: 84, resize: "vertical" }}
              placeholder="Message"
              value={form.message}
              onChange={(e) => updateForm({ message: e.target.value })}
            />

            <select
              className="app-input"
              value={form.eventId}
              onChange={(e) => updateForm({ eventId: e.target.value })}
              style={{ color: form.eventId ? "#2D3852" : "#9AA3B8" }}
            >
              <option value="">No linked event</option>
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} — {formatShortDateTime(ev.start_time)}
                </option>
              ))}
            </select>

            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "#9AA3B8", letterSpacing: "0.04em", marginBottom: 7, textTransform: "uppercase" }}>
                Audience
              </p>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {CONTACT_TYPES.map((type) => {
                  const selected = form.contactTypes.includes(type.key);
                  return (
                    <button
                      key={type.key}
                      type="button"
                      onClick={() => toggleContactType(type.key)}
                      className="press-scale"
                      style={{
                        borderRadius: 20,
                        padding: "6px 13px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        border: "1px solid transparent",
                        background: selected ? "#2D3852" : "#FFFFFF",
                        color: selected ? "#FFFFFF" : "#6E7892",
                        borderColor: selected ? "transparent" : "#E4EAF0",
                        cursor: "pointer",
                      }}
                    >
                      {type.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <input
                className="app-input"
                placeholder="Specific startups (optional) — IDs, comma separated"
                value={form.startupIds}
                onChange={(e) => updateForm({ startupIds: e.target.value })}
                list="campaign-startup-options"
              />
              <datalist id="campaign-startup-options">
                {startups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </datalist>
              {filters.startup_ids.length > 0 && (
                <p style={{ fontSize: 10.5, color: "#9AA3B8", marginTop: 5 }}>{unresolvedStartupNames.join(", ")}</p>
              )}
            </div>

            <label className="flex items-center cursor-pointer select-none" style={{ gap: 9 }}>
              <input
                type="checkbox"
                checked={form.onIslandToday}
                onChange={(e) => updateForm({ onIslandToday: e.target.checked })}
                className="hidden"
              />
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  border: form.onIslandToday ? "none" : "1.5px solid #B0BAD0",
                  background: form.onIslandToday ? "#2D3852" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "background 0.15s ease, border-color 0.15s ease",
                }}
              >
                {form.onIslandToday && (
                  <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                    <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "#2D3852" }}>On-site today only</span>
            </label>

            <div>
              <p style={{ fontSize: 10.5, fontWeight: 700, color: "#9AA3B8", letterSpacing: "0.04em", marginBottom: 7, textTransform: "uppercase" }}>
                Delivery
              </p>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {MODES.map((m) => {
                  const selected = form.mode === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => updateForm({ mode: m.key })}
                      className="press-scale"
                      style={{
                        borderRadius: 20,
                        padding: "6px 13px",
                        fontSize: 11.5,
                        fontWeight: 600,
                        border: "1px solid transparent",
                        background: selected ? "#1FD0EF" : "#FFFFFF",
                        color: selected ? "#2D3852" : "#6E7892",
                        borderColor: selected ? "transparent" : "#E4EAF0",
                        cursor: "pointer",
                      }}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
              {form.mode === "schedule" && (
                <>
                  <input
                    type="datetime-local"
                    className="app-input"
                    style={{ marginTop: 8 }}
                    value={form.scheduledFor}
                    onChange={(e) => updateForm({ scheduledFor: e.target.value })}
                  />
                  <p style={{ fontSize: 10.5, color: "#9AA3B8", margin: "5px 2px 0" }}>Mexico time (CDMX)</p>
                </>
              )}
            </div>

            {error && (
              <p style={{ fontSize: 11, color: "#D9534F", display: "flex", alignItems: "center", gap: 5 }}>
                <AlertCircle size={12} /> {error}
              </p>
            )}

            {preview && (
              <div className="rounded-[16px]" style={{ background: "#F2F8FA", padding: "10px 14px" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#2D3852" }}>
                  {preview.count} recipient{preview.count === 1 ? "" : "s"} match this audience
                </p>
                {preview.recipients?.length > 0 && (
                  <p style={{ fontSize: 10.5, color: "#6E7892", marginTop: 3 }}>
                    {preview.recipients.map((r) => r.full_name).slice(0, 8).join(", ")}
                    {preview.count > 8 ? "…" : ""}
                  </p>
                )}
              </div>
            )}

            <div className="flex" style={{ gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={handlePreview}
                disabled={busy}
                className="press-scale"
                style={{
                  flex: 1,
                  borderRadius: 20,
                  padding: "11px 14px",
                  fontSize: 11.5,
                  fontWeight: 700,
                  background: "#FFFFFF",
                  color: "#2D3852",
                  border: "1px solid #E4EAF0",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                Preview audience
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy}
                className="press-scale"
                style={{
                  flex: 1,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  borderRadius: 20,
                  padding: "11px 14px",
                  fontSize: 11.5,
                  fontWeight: 800,
                  background: "#2D3852",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.65 : 1,
                }}
              >
                {form.mode === "send_now" ? <Send size={12} /> : editingId ? <Pencil size={12} /> : <FileEdit size={12} />}
                {editingId && form.mode !== "send_now" ? "Save changes" : MODES.find((m) => m.key === form.mode)?.label}
              </button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#2D3852", fontFamily: "Fustat, sans-serif" }}>
            Notifications
          </p>
          <button
            type="button"
            onClick={() => loadCampaigns().catch(() => {})}
            className="press-scale"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10.5, fontWeight: 700, color: "#6E7892", background: "none", border: "none", cursor: "pointer" }}
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        {loading ? (
          <LoadingState message="Loading notifications" />
        ) : campaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title="No notifications yet" hint="Notifications you create will appear here, grouped by day." />
        ) : (
          <AnimatePresence>
            {grouped.map(([dayKey, items], groupIndex) => (
              <Motion.div
                key={dayKey}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING, delay: stagger(groupIndex) }}
                style={{ marginBottom: 18 }}
              >
                <p style={{ fontSize: 10.5, fontWeight: 800, color: "#9AA3B8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>
                  {dayHeading(dayKey)}
                </p>
                <div className="card-list">
                  {items.map((campaign) => {
                    const meta = STATUS_META[campaign.status] || STATUS_META.draft;
                    const editable = campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "failed";
                    const timePrefix =
                      campaign.status === "sent"
                        ? "Sent"
                        : campaign.status === "scheduled"
                          ? "Scheduled"
                          : campaign.status === "processing"
                            ? "Sending"
                            : campaign.status === "failed"
                              ? "Failed"
                              : "Created";
                    return (
                      <div
                        key={campaign.id}
                        className="notification-card rounded-[20px] border"
                        style={{ background: "#FFFFFF", borderColor: "#EEF2F5" }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852", lineHeight: 1.3 }}>{campaign.title}</p>
                          <span
                            style={{
                              flexShrink: 0,
                              borderRadius: 20,
                              padding: "3px 9px",
                              fontSize: 9.5,
                              fontWeight: 800,
                              letterSpacing: "0.02em",
                              background: meta.bg,
                              color: meta.fg,
                            }}
                          >
                            {meta.label}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "#6E7892", marginTop: 4 }} className="line-clamp-2">
                          {campaign.message}
                        </p>
                        <p style={{ fontSize: 10, color: "#6E7892", opacity: 0.8, marginTop: 6 }}>
                          {timePrefix} · {formatTime(campaign._displayAt)} · {describeAudience(campaign.filters_json)}
                          {campaign.event?.title ? ` · ${campaign.event.title}` : ""}
                        </p>
                        {campaign.status === "sent" && (
                          <p style={{ fontSize: 10, color: "#9AA3B8", marginTop: 3 }}>
                            {campaign.target_count} targeted · {campaign.pushed_count} pushed
                          </p>
                        )}
                        {campaign.status === "failed" && campaign.error_message && (
                          <p style={{ fontSize: 10, color: "#D9534F", marginTop: 3 }}>{campaign.error_message}</p>
                        )}

                        <div className="flex items-center" style={{ gap: 6, marginTop: 10 }}>
                          {editable && (
                            <>
                              <button
                                type="button"
                                onClick={() => startEdit(campaign)}
                                className="press-scale"
                                style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "6px 11px", fontSize: 10.5, fontWeight: 700, background: "#F2F8FA", color: "#2D3852", border: "none", cursor: "pointer" }}
                              >
                                <Pencil size={11} /> Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendNow(campaign.id)}
                                disabled={busy}
                                className="press-scale"
                                style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "6px 11px", fontSize: 10.5, fontWeight: 700, background: "#E6F8FC", color: "#0C7A90", border: "none", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
                              >
                                <Send size={11} /> {campaign.status === "failed" ? "Retry" : "Send now"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(campaign)}
                                disabled={busy}
                                className="press-scale"
                                style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 20, padding: "6px 9px", fontSize: 10.5, fontWeight: 700, background: "none", color: "#B9C1D4", border: "none", cursor: busy ? "default" : "pointer" }}
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                          {campaign.status === "scheduled" && campaign.scheduled_for && (
                            <span style={{ marginLeft: editable ? 0 : "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, color: "#9AA3B8" }}>
                              <CalendarClock size={11} />
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
