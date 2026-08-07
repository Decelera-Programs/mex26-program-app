import { Link } from "react-router-dom";
import { Clock, MapPin } from "lucide-react";
import moment from "moment";
import { motion as Motion } from "framer-motion";
import { typeBgColors } from "../theme/eventTheming";

function getStartCountdown(startTime, endTime) {
  const now = moment();
  if (now.isSameOrAfter(endTime)) return { value: "Done", label: "status" };
  if (now.isSameOrAfter(startTime)) return { value: "Now", label: "status" };

  const minutesUntilStart = startTime.diff(now, "minutes");

  if (minutesUntilStart < 60) return { value: `${minutesUntilStart} mins`, label: "left" };

  const hours = Math.floor(minutesUntilStart / 60);
  const minutes = minutesUntilStart % 60;
  if (minutes === 0) return { value: `${hours}h`, label: "left" };
  return { value: `${hours}h ${minutes}m`, label: "left" };
}

export default function EventCard({ event, index = 0, isPast = false }) {
  const startTime = moment(event.start_time);
  const endTime = moment(event.end_time);
  const countdown = getStartCountdown(startTime, endTime);

  return (
    <Motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Link to={`/event/${event.id}`} className="block">
        <div
          className={`app-card-interactive p-4 mb-3 ${isPast ? "opacity-55" : ""} ${
            typeBgColors[event.type] || "bg-card border-border"
          }`}
        >
          <div className="flex items-start gap-5">
            <div className="min-w-[64px] rounded-xl bg-white/70 border border-border/40 px-2 py-2 text-center">
              <p className="text-sm font-semibold text-foreground leading-none">{countdown.value}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{countdown.label}</p>
            </div>

            <div className="flex-1 min-w-0 pl-1">
              <p className="text-sm font-semibold text-foreground leading-tight">{event.title}</p>

              <div className="mt-2.5 space-y-1.5 text-muted-foreground">
                <p className="event-meta-row text-xs">
                  <Clock className="event-meta-icon" />
                  {startTime.format("h:mm")} - {endTime.format("h:mm A")}
                </p>
                <p className="event-meta-row text-xs truncate">
                  <MapPin className="event-meta-icon" />
                  <span className="truncate">{event.location}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </Motion.div>
  );
}

