import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { API_BASE_URL } from "../lib/apiBaseUrl";

export default function UserNotRegisteredError() {
  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDebug() {
      try {
        if (!supabase) return;
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;

        const response = await fetch(`${API_BASE_URL}/auth/debug-link`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await response.json().catch(() => null);
        if (!cancelled) setDebugInfo(payload);
      } catch (error) {
        if (!cancelled) {
          setDebugInfo({
            error: "Could not fetch debug-link endpoint",
            apiBaseUrl: API_BASE_URL,
            detail: error instanceof Error ? error.message : "unknown error",
          });
        }
      }
    }
    fetchDebug();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-dvh bg-white px-5">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-slate-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-primary/10">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Access Restricted</h1>
          <p className="text-slate-600 mb-8">
            You are not registered to use this application. Please contact the app administrator to request access.
          </p>
          <div className="p-4 bg-white border border-primary/20 rounded-md text-sm text-slate-600 text-left">
            <p>If you believe this is an error, you can:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Verify you are logged in with the correct account</li>
              <li>Contact the app administrator for access</li>
              <li>Try logging out and back in again</li>
            </ul>
          </div>
          {debugInfo && (
            <pre className="mt-4 p-3 text-[11px] bg-slate-50 border border-slate-200 rounded-md text-slate-700 overflow-x-auto text-left">
              {JSON.stringify(debugInfo, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

