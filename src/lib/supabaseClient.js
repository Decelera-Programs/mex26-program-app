import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
function isValidSupabaseHttpUrl(value) {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

const hasValidUrl = isValidSupabaseHttpUrl(supabaseUrl);
const isConfigured = Boolean(hasValidUrl && supabaseAnonKey);

if (!isConfigured) {
  console.warn("Supabase env vars are missing: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY");
}

export const supabaseConfigError = isConfigured
  ? ""
  : "Invalid Supabase config in .env. VITE_SUPABASE_URL must be your https://<project>.supabase.co URL and VITE_SUPABASE_ANON_KEY must be set.";

export const supabase = isConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

// Captured before Supabase processes and removes auth params from the URL
export const initialAuthSearch = window.location.search;
export const initialAuthHash = window.location.hash;

