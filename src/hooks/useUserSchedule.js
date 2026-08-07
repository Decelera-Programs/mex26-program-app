import { useEffect, useState } from "react";
import { getCurrentUser, listUserScheduleEvents } from "../api/dataService";

export function useUserSchedule() {
  const [events, setEvents] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      try {
        let me = null;
        for (let i = 0; i < 5; i += 1) {
          me = await getCurrentUser();
          if (me) break;
          await new Promise((resolve) => setTimeout(resolve, 300));
          if (cancelled) return;
        }
        if (cancelled) return;
        setUser(me);

        if (me?.email) {
          try {
            const myEvents = await listUserScheduleEvents(me.email);
            if (cancelled) return;
            setEvents(myEvents);
          } catch {
            // Keep authenticated user even if schedule endpoint fails.
            if (cancelled) return;
            setEvents([]);
          }
        } else {
          setEvents([]);
        }
      } catch {
        if (cancelled) return;
        // Only null user when identity lookup itself fails.
        setUser(null);
        setEvents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, []);

  return { events, user, loading };
}

