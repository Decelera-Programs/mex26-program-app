import { useMemo, useState } from "react";
import {
  createCampaign,
  listCampaigns,
  previewCampaignAudience,
  sendCampaignNow,
} from "../api/dataService";

const CONTACT_TYPES = [
  "experience_maker",
  "founder",
  "vc",
  "team",
  "lp",
];

export default function Campaigns() {
  const [adminKey, setAdminKey] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [eventId, setEventId] = useState("");
  const [contactTypes, setContactTypes] = useState(["experience_maker"]);
  const [startupIds, setStartupIds] = useState("");
  const [onIslandToday, setOnIslandToday] = useState(false);
  const [mode, setMode] = useState("draft");
  const [scheduledFor, setScheduledFor] = useState("");
  const [preview, setPreview] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const filters = useMemo(
    () => ({
      contact_types: contactTypes,
      startup_ids: startupIds
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      on_island_today: onIslandToday,
    }),
    [contactTypes, startupIds, onIslandToday],
  );

  async function loadCampaigns() {
    setError("");
    setBusy(true);
    try {
      const data = await listCampaigns(adminKey);
      setCampaigns(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load campaigns");
    } finally {
      setBusy(false);
    }
  }

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

  async function handleCreate() {
    setError("");
    setBusy(true);
    try {
      await createCampaign(
        {
          title,
          message,
          event_id: eventId || null,
          filters,
          mode,
          scheduled_for: mode === "schedule" && scheduledFor ? new Date(scheduledFor).toISOString() : null,
        },
        adminKey,
      );
      await loadCampaigns();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create campaign");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dispatch campaign");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-5 pt-14 pb-6">
      <h1 className="text-2xl font-bold font-display mb-1">Campaigns</h1>
      <p className="text-xs text-muted-foreground mb-6">Internal tool for grouped push notifications.</p>

      <div className="app-card p-4 space-y-3">
        <input
          className="app-input"
          placeholder="Admin key (x-admin-key)"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
        />
        <input className="app-input" placeholder="Campaign title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className="app-input min-h-[88px]"
          placeholder="Message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <input className="app-input" placeholder="Event ID (optional)" value={eventId} onChange={(e) => setEventId(e.target.value)} />
        <input
          className="app-input"
          placeholder="Startup IDs separated by comma (optional)"
          value={startupIds}
          onChange={(e) => setStartupIds(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {CONTACT_TYPES.map((type) => {
            const selected = contactTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() =>
                  setContactTypes((prev) =>
                    prev.includes(type) ? prev.filter((v) => v !== type) : [...prev, type],
                  )
                }
                className={`px-3 py-1 rounded-full text-xs ${selected ? "bg-primary text-primary-foreground" : "app-card"}`}
              >
                {type}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onIslandToday} onChange={(e) => setOnIslandToday(e.target.checked)} />
          On island today
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select className="app-input max-w-[180px]" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="draft">draft</option>
            <option value="send_now">send_now</option>
            <option value="schedule">schedule</option>
          </select>
          {mode === "schedule" ? (
            <input
              type="datetime-local"
              className="app-input max-w-[260px]"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
            />
          ) : null}
          <button type="button" onClick={handlePreview} disabled={busy} className="app-card px-4 py-2 text-sm disabled:opacity-50">
            Preview
          </button>
          <button type="button" onClick={handleCreate} disabled={busy} className="app-card px-4 py-2 text-sm disabled:opacity-50">
            Save / Send
          </button>
          <button type="button" onClick={loadCampaigns} disabled={busy} className="app-card px-4 py-2 text-sm disabled:opacity-50">
            Refresh list
          </button>
        </div>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
        {busy ? <p className="text-xs text-muted-foreground">Working...</p> : null}
      </div>

      {preview ? (
        <div className="app-card p-4 mt-4">
          <p className="text-sm font-semibold">Audience preview: {preview.count}</p>
        </div>
      ) : null}

      <div className="mt-6 card-list">
        {campaigns.map((campaign) => (
          <div key={campaign.id} className="app-card p-4">
            <p className="text-sm font-semibold">{campaign.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{campaign.status}</p>
            <p className="text-xs text-muted-foreground mt-1">
              target {campaign.target_count} · created {campaign.created_notifications_count} · pushed {campaign.pushed_count}
            </p>
            {campaign.status !== "sent" ? (
              <button
                type="button"
                onClick={() => handleSendNow(campaign.id)}
                disabled={busy}
                className="mt-3 app-card px-3 py-1.5 text-xs disabled:opacity-50"
              >
                Send now
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

