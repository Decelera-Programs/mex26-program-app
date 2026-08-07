// Standalone mock data for the "Decelera Menorca 2026" PWA.
// This replaces all Base44 entity lists/filters with local constants.

export const GUEST_USER = {
  email: "guest@decelera.com",
  full_name: "Guest User",
};

/**
 * Entity: Event
 * Required by the blueprint: title, start_time, end_time, location, event_type
 * Optional: description
 */
export const MOCK_EVENTS = [
  {
    id: "evt_welcome_2026_04_12_0900",
    title: "Welcome & Check-in",
    description: "Kick off the week, collect your badge, and meet the cohort.",
    start_time: "2026-04-12T09:00:00+02:00",
    end_time: "2026-04-12T10:00:00+02:00",
    location: "Hotel Artiem Capri · Lobby",
    type: "ceremony",
  },
  {
    id: "evt_workshop_pitch_2026_04_12_1030",
    title: "Workshop: Pitch Fundamentals",
    description: "A practical session on story, structure, and delivery.",
    start_time: "2026-04-12T10:30:00+02:00",
    end_time: "2026-04-12T12:00:00+02:00",
    location: "Artiem Capri · Salon A",
    type: "workshop",
  },
  {
    id: "evt_lunch_2026_04_12_1300",
    title: "Lunch",
    description: "Buffet lunch with vegetarian options.",
    start_time: "2026-04-12T13:00:00+02:00",
    end_time: "2026-04-12T14:00:00+02:00",
    location: "Artiem Capri · Restaurant",
    type: "meal",
  },
  {
    id: "evt_talk_growth_2026_04_13_0930",
    title: "Talk: Growth Loops That Compound",
    description: "How to design growth loops and measure what matters.",
    start_time: "2026-04-13T09:30:00+02:00",
    end_time: "2026-04-13T10:15:00+02:00",
    location: "Artiem Capri · Main Hall",
    type: "talk",
  },
  {
    id: "evt_networking_2026_04_13_1830",
    title: "Networking Sunset",
    description: "Meet founders, VCs, and mentors over drinks.",
    start_time: "2026-04-13T18:30:00+02:00",
    end_time: "2026-04-13T19:30:00+02:00",
    location: "Fornells · Seafront Terrace",
    type: "networking",
  },
];

/**
 * Entity: Startup
 */
export const MOCK_STARTUPS = [
  {
    id: "stp_tideai",
    name: "TideAI",
    tagline: "Forecasting coastal risk for a changing climate.",
    description:
      "TideAI helps coastal cities anticipate flooding and plan resilient infrastructure with better models and clearer decision tools.",
    sector: "Climate Tech",
    stage: "seed",
    logo_url: "",
    website_url: "https://example.com/tideai",
    hq_location: "Barcelona, ES",
    founding_year: 2023,
  },
  {
    id: "stp_orchard",
    name: "OrchardOS",
    tagline: "Farm ops management for small producers.",
    description:
      "OrchardOS unifies inventory, tasks, and sales channels into one lightweight workflow built for growers.",
    sector: "AgriTech",
    stage: "pre-seed",
    logo_url: "",
    website_url: "https://example.com/orchardos",
    hq_location: "Valencia, ES",
    founding_year: 2024,
  },
  {
    id: "stp_lumenpay",
    name: "LumenPay",
    tagline: "Instant payouts for global contractors.",
    description:
      "LumenPay offers compliant contractor payouts with transparent fees and multi-currency settlement.",
    sector: "FinTech",
    stage: "seed",
    logo_url: "",
    website_url: "https://example.com/lumenpay",
    hq_location: "London, UK",
    founding_year: 2022,
  },
  {
    id: "stp_vitru",
    name: "Vitru Health",
    tagline: "Physical therapy, reimagined for busy teams.",
    description:
      "Vitru brings personalized PT programs to employees with remote assessment and progress tracking.",
    sector: "HealthTech",
    stage: "series-a",
    logo_url: "",
    website_url: "https://example.com/vitru",
    hq_location: "Berlin, DE",
    founding_year: 2021,
  },
  {
    id: "stp_brighthub",
    name: "BrightHub",
    tagline: "The simplest knowledge base your team will actually use.",
    description:
      "BrightHub keeps internal docs fresh with ownership, review cycles, and AI-assisted summaries.",
    sector: "SaaS",
    stage: "pre-seed",
    logo_url: "",
    website_url: "https://example.com/brighthub",
    hq_location: "Lisbon, PT",
    founding_year: 2025,
  },
];

/**
 * Entity: Person
 */
export const MOCK_PEOPLE = [
  {
    id: "per_ana_morales",
    full_name: "Ana Morales",
    title: "Experience Maker",
    company: "Decelera",
    bio: "Early-stage coach focused on narrative, positioning, and product clarity.",
    photo_url: "",
    person_type: "experience_maker",
    linkedin_url: "https://www.linkedin.com/in/example-ana-morales/",
    twitter_url: "",
    website_url: "",
    expertise_tags: ["Pitch", "Storytelling", "Positioning"],
    availability_note: "Available Mon/Wed for 1:1s (15:00–17:00).",
  },
  {
    id: "per_miguel_serrano",
    full_name: "Miguel Serrano",
    title: "Partner",
    company: "Sunset Ventures",
    bio: "Investor in B2B SaaS and developer tools. Loves strong distribution.",
    photo_url: "",
    person_type: "vc",
    linkedin_url: "https://www.linkedin.com/in/example-miguel-serrano/",
    twitter_url: "",
    website_url: "",
    expertise_tags: ["Go-to-market", "SaaS", "Fundraising"],
    availability_note: "Office hours Tue/Thu morning.",
  },
  {
    id: "per_luiza_zinca",
    full_name: "Luiza Zinca",
    title: "Co-founder & CEO",
    company: "TideAI",
    bio: "Building decision-grade coastal forecasts for cities and insurers.",
    photo_url: "",
    person_type: "founder",
    linkedin_url: "https://www.linkedin.com/in/example-luiza-zinca/",
    twitter_url: "",
    website_url: "https://example.com/tideai",
    startup_id: "stp_tideai",
    expertise_tags: ["Climate", "Data", "Partnerships"],
    availability_note: "",
  },
  {
    id: "per_ricardo_nunes",
    full_name: "Ricardo Nunes",
    title: "Co-founder",
    company: "BrightHub",
    bio: "Building calmer internal documentation habits for growing teams.",
    photo_url: "",
    person_type: "founder",
    linkedin_url: "https://www.linkedin.com/in/example-ricardo-nunes/",
    twitter_url: "",
    website_url: "https://example.com/brighthub",
    startup_id: "stp_brighthub",
    expertise_tags: ["Product", "Docs", "Workflows"],
    availability_note: "",
  },
  {
    id: "per_carlos_ortiz",
    full_name: "Carlos Ortiz",
    title: "Programme Ops",
    company: "Decelera",
    bio: "On-site support and logistics coordinator for the week.",
    photo_url: "",
    person_type: "team",
    linkedin_url: "https://www.linkedin.com/in/example-carlos-ortiz/",
    twitter_url: "",
    website_url: "",
    expertise_tags: ["Operations", "Logistics"],
    availability_note: "Ping me anytime for transport / venue issues.",
  },
];

/**
 * Entity: UserEvent
 * Connects a user (email) to event IDs they are assigned to.
 */
export const MOCK_USER_EVENTS = [
  {
    id: "ue_guest_1",
    user_email: GUEST_USER.email,
    event_id: "evt_welcome_2026_04_12_0900",
    notified_30min: true,
    notified_5min: false,
  },
  {
    id: "ue_guest_2",
    user_email: GUEST_USER.email,
    event_id: "evt_workshop_pitch_2026_04_12_1030",
    notified_30min: false,
    notified_5min: false,
  },
  {
    id: "ue_guest_3",
    user_email: GUEST_USER.email,
    event_id: "evt_lunch_2026_04_12_1300",
    notified_30min: false,
    notified_5min: false,
  },
  {
    id: "ue_guest_4",
    user_email: GUEST_USER.email,
    event_id: "evt_talk_growth_2026_04_13_0930",
    notified_30min: false,
    notified_5min: false,
  },
  {
    id: "ue_guest_5",
    user_email: GUEST_USER.email,
    event_id: "evt_networking_2026_04_13_1830",
    notified_30min: false,
    notified_5min: false,
  },
];

/**
 * Entity: Notification
 * Mirrors the blueprint fields: user_email, event_id, title, message, type, is_read
 * We also include created_date because the blueprint renders "fromNow()".
 */
export const MOCK_NOTIFICATIONS = [
  {
    id: "ntf_1",
    user_email: GUEST_USER.email,
    event_id: "evt_welcome_2026_04_12_0900",
    title: "Welcome starts soon",
    message: "Check-in begins in 30 minutes at the lobby.",
    type: "30min_reminder",
    is_read: true,
    created_date: "2026-04-12T08:30:00+02:00",
  },
  {
    id: "ntf_2",
    user_email: GUEST_USER.email,
    event_id: "evt_workshop_pitch_2026_04_12_1030",
    title: "Pitch workshop reminder",
    message: "Your workshop starts in 30 minutes in Salon A.",
    type: "30min_reminder",
    is_read: false,
    created_date: "2026-04-12T10:00:00+02:00",
  },
  {
    id: "ntf_3",
    user_email: GUEST_USER.email,
    event_id: "evt_workshop_pitch_2026_04_12_1030",
    title: "Starting now",
    message: "Pitch Fundamentals is about to begin — see you inside.",
    type: "5min_reminder",
    is_read: false,
    created_date: "2026-04-12T10:25:00+02:00",
  },
  {
    id: "ntf_4",
    user_email: GUEST_USER.email,
    event_id: "",
    title: "WiFi info",
    message: "Network: Decelera2026 · Password: menorca2026!",
    type: "general",
    is_read: true,
    created_date: "2026-04-12T12:10:00+02:00",
  },
  {
    id: "ntf_5",
    user_email: GUEST_USER.email,
    event_id: "evt_networking_2026_04_13_1830",
    title: "Sunset networking later",
    message: "Meet the group at the seafront terrace at 18:30.",
    type: "30min_reminder",
    is_read: false,
    created_date: "2026-04-13T18:00:00+02:00",
  },
];

export function getGuestScheduleEvents() {
  const assignedIds = new Set(
    MOCK_USER_EVENTS.filter((ue) => ue.user_email === GUEST_USER.email).map((ue) => ue.event_id),
  );
  return MOCK_EVENTS.filter((e) => assignedIds.has(e.id));
}

