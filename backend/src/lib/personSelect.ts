// Shared select for exposing a Person over the API — every field a client is
// allowed to see, nothing internal-only (no legal_maze, olbi_brs, etc.).
export const personSafeSelect = {
  id: true,
  email: true,
  user_id: true,
  full_name: true,
  bio: true,
  tagline: true,
  photo_url: true,
  linkedin_url: true,
  company_name: true,
  contact_type: true,
  arrival_date: true,
  departure_date: true,
  expertise_tags: true,
  schedule_feedback: true,
  startup_id: true,
  post_program_expectations: true,
  fun_fact: true,
  createdAt: true,
  updatedAt: true,
  startup: true,
} as const;
