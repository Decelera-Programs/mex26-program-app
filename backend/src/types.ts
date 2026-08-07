export type EventType =
  | "workshop"
  | "talk"
  | "networking"
  | "meal"
  | "activity"
  | "ceremony"
  | "mentoring"
  | "free_time"
  | "Demo"
  | "demo";

export type Startup = {
  id: string;
  name: string;
  tagline?: string | null;
  sector?: string | null;
  stage?: string | null;
  logo_url?: string | null;
  website_url?: string | null;
  one_pager_url?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Person = {
  id: string;
  full_name: string;
  bio?: string | null;
  photo_url?: string | null;
  linkedin_url?: string | null;
  company_name?: string | null;
  contact_type?: string | null;
  arrival_date?: Date | null;
  departure_date?: Date | null;
  expertise_tags: string[]; // stored in DB as JSON (or JSON string for SQLite)
  startup_id?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type Event = {
  id: string;
  title: string;
  description?: string | null;
  start_time: Date;
  end_time: Date;
  location: string;
  type: EventType;
  visible_to_contact_types?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EventSpeaker = {
  id: string;
  person_id: string;
  event_id: string;
  createdAt: Date;
};

export type Notification = {
  id: string;
  user_id: string;
  event_id?: string | null;
  message: string;
  is_read: boolean;
  sent_at: Date;
};

