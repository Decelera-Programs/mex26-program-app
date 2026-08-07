import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, MapPin, ArrowRight } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { typeGradients } from "../theme/eventTheming";
import { formatTime } from "../lib/dateTime";

export default function NextEventCard({ event }) {
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    if (!event) return;

    const updateCountdown = () => {
      const nowMs = Date.now();
      const startMs = new Date(event.start_time).getTime();
      const endMs = new Date(event.end_time).getTime();
      const diff = startMs - nowMs;

      if (diff <= 0) {
        if (nowMs < endMs) {
          setCountdown("Happening now");
        } else {
          setCountdown("Ended");
        }
      } else {
        const totalMinutes = Math.floor(diff / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours >= 1) {
          setCountdown(`Starts in ${hours}h ${minutes}m`);
        } else {
          setCountdown(`Starts in ${Math.max(1, minutes)}m`);
        }
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 15000);
    return () => clearInterval(interval);
  }, [event]);

  if (!event) {
    return (
      <div className="app-card p-6">
        <p className="text-muted-foreground text-sm">No upcoming events</p>
      </div>
    );
  }

  const isHappening = countdown === "Happening now";
  const gradient = typeGradients[event.type] || "from-primary to-primary";

  return (
    <Link to={`/event/${event.id}`}>
      <Motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className={`bg-gradient-to-br ${gradient} text-white p-6 rounded-2xl relative overflow-hidden shadow-sm`}
      >
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 rounded-full bg-white/5" />

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                isHappening ? "bg-white/30 animate-pulse" : "bg-white/20"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isHappening ? "bg-white" : "bg-white/80"}`} />
              {countdown}
            </span>
            <ArrowRight className="h-4 w-4 opacity-60" />
          </div>

          <h3 className="text-xl font-bold mb-3 leading-tight">{event.title}</h3>

          <div className="flex items-center gap-4 text-white/80 text-sm">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {formatTime(event.start_time)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {event.location}
            </span>
          </div>
        </div>
      </Motion.div>
    </Link>
  );
}

