import { Link } from "react-router-dom";
import { useState } from "react";
import { motion as Motion } from "framer-motion";

const typeColors = {
  experience_maker: "#1FD0EF",
  team: "#B9C1D4",
  vc: "#2D3852",
  alumni: "#FFB950",
  founder: "#FFB950",
};

export default function PersonCard({ person, index = 0 }) {
  const contactType = person.contact_type || person.person_type || "";
  const normalizedContactType = String(contactType).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const [imageFailed, setImageFailed] = useState(false);
  const initials = person.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const accentColor = typeColors[normalizedContactType] || "#B9C1D4";

  return (
    <Motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
    >
      <Link to={`/person/${person.id}`} className="block">
        <div
          className="app-card-interactive person-card"
          style={{ borderLeft: `5px solid ${accentColor}` }}
        >
          <div className="flex items-center gap-[14px]">
            {person.photo_url && !imageFailed ? (
              <div
                className="overflow-hidden flex-shrink-0 bg-white border border-[#E2E7ED]"
                style={{ width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: 12 }}
              >
                <img
                  src={person.photo_url}
                  alt={person.full_name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="object-cover"
                  style={{ width: "100%", height: "100%", display: "block" }}
                />
              </div>
            ) : (
              <div
                className="flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                style={{ width: 48, height: 48, minWidth: 48, minHeight: 48, borderRadius: 12, background: accentColor }}
              >
                {initials}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-foreground text-sm" style={{ margin: 0 }}>{person.full_name}</p>
              {person.tagline && (
                <p
                  style={{
                    fontSize: 11,
                    color: "#6E7892",
                    marginTop: 2,
                    marginBottom: 0,
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 1,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {person.tagline}
                </p>
              )}
            </div>
          </div>
        </div>
      </Link>
    </Motion.div>
  );
}
