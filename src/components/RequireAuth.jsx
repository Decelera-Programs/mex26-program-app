import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import Loader from "./Loader";
import { supabase, supabaseConfigError } from "../lib/supabaseClient";

export default function RequireAuth({ children }) {
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const client = supabase;
    if (!client?.auth) {
      setLoading(false);
      setIsAuthenticated(false);
      return () => {};
    }

    let mounted = true;

    async function checkSession() {
      const { data } = await client.auth.getSession();
      if (!mounted) return;
      setIsAuthenticated(Boolean(data.session));
      setLoading(false);
    }

    checkSession();

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setIsAuthenticated(Boolean(session));
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  if (!supabase) {
    return (
      <div className="min-h-dvh bg-background px-5 flex items-center justify-center">
        <div className="app-card w-full max-w-sm p-6">
          <h1 className="text-xl font-bold text-foreground">Supabase not configured</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {supabaseConfigError}
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-white">
        <Loader size={120} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

