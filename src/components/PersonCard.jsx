import { Link } from "react-router-dom";
import { useState } from "react";
import { motion as Motion } from "framer-motion";

// Role -> label + the small dot colour next to it. Muted, evenly weighted;
// the dot is the only colour on the card, everything else is neutral.
const ROLE_META = {
  experience_maker: { label: "Experience Maker", dot: "var(--dc-role-em, #1f9aaf)" },
  founder: { label: "Founder", dot: "var(--dc-role-founder, #c77b4a)" },
  vc: { label: "Investor", dot: "var(--dc-role-vc, #5e6aa0)" },
  team: { label: "Team", dot: "var(--dc-role-team, #98a0b3)" },
  alumni: { label: "Alumni", dot: "var(--dc-role-founder, #c77b4a)" },
};

export default function PersonCard({ person, index = 0 }) {
  const [imageFailed, setImageFailed] = useState(false);

  const rawType = person.contact_type || person.person_type || "";
  const normalizedType = String(rawType).trim().toLowerCase().replace(/[\s-]+/g, "_");
  const role = ROLE_META[normalizedType] || null;

  const initials = (person.full_name || "")
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // A concrete affiliation to sit after the role label.
  const affiliation =
    (normalizedType === "founder" && person.startup?.name) ||
    person.company ||
    person.startup?.name ||
    person.title ||
    "";

  return (
    <Motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.44, delay: Math.min(index, 10) * 0.06, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link to={`/person/${person.id}`} className="block">
        <div className="app-card-interactive person-card">
          <div className="flex items-center gap-[13px]">
            <div
              className="flex items-center justify-center flex-shrink-0 overflow-hidden"
              style={{
                width: 46,
                height: 46,
                minWidth: 46,
                borderRadius: 13,
                background: "#EEF2F5",
                color: "#2D3852",
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              {person.photo_url && !imageFailed ? (
                <img
                  src={person.photo_url}
                  alt={person.full_name}
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              ) : (
                initials
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p
                className="font-semibold text-foreground"
                style={{ margin: 0, fontSize: 14, lineHeight: 1.25 }}
              >
                {person.full_name}
              </p>

              {role && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0 }}>
                  <span
                    aria-hidden="true"
                    style={{ width: 6, height: 6, borderRadius: 9999, background: role.dot, flex: "0 0 auto" }}
                  />
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#6E7892",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {role.label}
                    {affiliation ? <span style={{ color: "#9AA3B8" }}> · {affiliation}</span> : null}
                  </span>
                </div>
              )}

              {person.tagline && (
                <p
                  style={{
                    fontSize: 11.5,
                    color: "#6E7892",
                    lineHeight: 1.4,
                    margin: "5px 0 0",
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
