import { motion as Motion } from "framer-motion";
import { MapPin, Plane, Utensils, Sun, Phone, AlertCircle } from "lucide-react";

// TODO: all logistics content below is still the Menorca 2026 venue (hotel,
// address, airport transfer instructions). Replace with the Decelera México 2026 details.
const HOTEL_MAP_URL =
  "https://www.google.com/maps/search/?api=1&query=Beach+Club+Menorca+Av.+de+la+Playa+Son+Parc+Menorca";

const sections = [
  {
    icon: MapPin,
    title: "Hotel",
    items: [
      { label: "Venue", value: "Beach Club Menorca" },
      {
        label: "Address",
        value: "Av. de la Playa, H2, 07740 Son Parc, Menorca, Spain",
        href: HOTEL_MAP_URL,
        linkLabel: "Open in Google Maps",
      },
      { label: "Included", value: "Accommodation and all meals." },
      { label: "Not included", value: "Local taxes." },
    ],
  },
  {
    icon: Plane,
    title: "Transfers",
    items: [
      {
        label: "Before arrival",
        value: "Exact transfer information will be sent by email 48 hours before your arrival date.",
      },
      {
        label: "At the airport",
        value:
          "After collecting your luggage, head to the exit and turn left. Look for the Autobuses Menorca desk with a DECELERA sign — their staff will assist you.",
      },
      {
        label: "Delays",
        value:
          "Transfer times are approximate and they will wait for you. If your flight is significantly delayed, contact Kamil on WhatsApp so we can arrange an alternative transfer.",
      },
      {
        label: "Return",
        value:
          "Your return transfer departs approximately 2–3 hours before your flight. Details will be sent 24 hours in advance.",
      },
    ],
  },
  {
    icon: Utensils,
    title: "Meals",
    items: [
      { label: "Restaurant", value: "Buffet restaurant at the hotel." },
      { label: "Breakfast", value: "8:00–9:30" },
      { label: "Lunch", value: "13:00–14:30" },
      { label: "Dinner", value: "19:00–21:30" },
    ],
  },
  {
    icon: Sun,
    title: "What to pack",
    items: [
      { label: "Essentials", value: "Passport and travel documents. Travel insurance." },
      {
        label: "Clothing",
        value:
          "Swimsuit, light and sports clothes, flip-flops or sandals, hat/cap and sunglasses. White outfit for the farewell party.",
      },
      { label: "Comfort", value: "Sunscreen, mosquito repellent, and a reusable water bottle." },
      {
        label: "Tip",
        value: "Clothing that covers your skin can also help protect you from mosquito bites.",
      },
    ],
  },
  {
    icon: Phone,
    title: "Logistics contact",
    items: [
      { label: "Name", value: "Kamil Saab Dávila" },
      { label: "Email", value: "kamil@decelera.com", href: "mailto:kamil@decelera.com" },
      { label: "Phone / WhatsApp", value: "+34 638 413 445", href: "tel:+34638413445" },
    ],
  },
  {
    icon: AlertCircle,
    title: "Medical emergencies",
    items: [
      {
        label: "If you need care",
        value: "Let the Decelera team know — we will take you to the nearest hospital in the area.",
      },
      { label: "Clínica Juaneda", value: "Mahón" },
      { label: "Hospital Mateo Orfila", value: "Mahón area" },
      { label: "Emergency", value: "112 (Spain)" },
    ],
  },
];

function LogisticsItem({ item, isFirst }) {
  const linkStyle = { fontSize: 13, fontWeight: 600, color: "#0A859B", lineHeight: 1.45 };

  return (
    <div
      style={{
        paddingTop: isFirst ? 0 : 10,
        borderTop: isFirst ? "none" : "1px solid #F0F4F7",
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#0A859B",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          margin: 0,
        }}
      >
        {item.label}
      </p>
      <p style={{ fontSize: 13, color: "#2D3852", marginTop: 3, lineHeight: 1.45 }}>
        {item.href && !item.linkLabel ? (
          <a
            href={item.href}
            target={item.href.startsWith("http") ? "_blank" : undefined}
            rel={item.href.startsWith("http") ? "noreferrer" : undefined}
            style={linkStyle}
          >
            {item.value}
          </a>
        ) : (
          item.value
        )}
      </p>
      {item.href && item.linkLabel && (
        <a
          href={item.href}
          target="_blank"
          rel="noreferrer"
          style={{ ...linkStyle, display: "inline-block", marginTop: 6, fontSize: 12 }}
        >
          {item.linkLabel}
        </a>
      )}
    </div>
  );
}

export default function Logistics() {
  return (
    <div className="w-full pt-[30px] pb-6 sm:pt-[40px]" style={{ background: "#F2F8FA" }}>
      <div style={{ width: "calc(100% - 20px)", maxWidth: 370 }} className="mx-auto flex flex-col gap-[9px]">
        <div
          className="relative overflow-hidden"
          style={{
            borderRadius: 20,
            padding: 22,
            background: "#FAF3DC",
            color: "#2D3852",
            boxShadow: "0 18px 40px rgba(31, 208, 239, 0.10)",
          }}
        >
          <div
            className="decelera-breathe-mark pointer-events-none absolute -right-14 -bottom-14 h-[210px] w-[210px] rounded-full"
            style={{ background: "rgba(45, 56, 82, 0.18)" }}
          />
          <Motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
            <h1 style={{ fontFamily: "Taviraj, serif", fontWeight: 300, fontSize: 28, color: "#2D3852", margin: 0 }}>
              Logistics
            </h1>
            <p style={{ fontSize: 12, color: "#6E7892", marginTop: 2 }}>
              Hotel, transfers, meals &amp; essentials · México 2026
            </p>
          </Motion.div>
        </div>

        {sections.map((section, i) => {
          const Icon = section.icon;
          return (
            <Motion.div
              key={section.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 + i * 0.05 }}
              style={{
                background: "#FFFFFF",
                border: "1px solid #EEF2F5",
                borderRadius: 20,
                padding: "16px 18px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "9999px",
                    background: "#ECFAFD",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Icon size={15} color="#0A859B" />
                </div>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#2D3852", margin: 0 }}>{section.title}</p>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {section.items.map((item, j) => (
                  <LogisticsItem key={item.label} item={item} isFirst={j === 0} />
                ))}
              </div>
            </Motion.div>
          );
        })}
      </div>
    </div>
  );
}
