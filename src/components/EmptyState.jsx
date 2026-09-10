import { motion as Motion } from "framer-motion";
import { DUR, EASE } from "../lib/motion";

// Small, calm empty state — an outlined icon in a soft disc, a title and a
// one-line hint. Used by the list pages instead of a bare line of grey text.
export default function EmptyState({ icon: Icon, title, hint }) {
  return (
    <Motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.base, ease: EASE.out }}
      className="flex flex-col items-center text-center"
      style={{ padding: "56px 24px" }}
    >
      {Icon ? (
        <div
          className="flex items-center justify-center"
          style={{ width: 44, height: 44, borderRadius: 9999, background: "#EEF2F5", marginBottom: 14 }}
        >
          <Icon size={20} strokeWidth={1.8} color="#9AA3B8" />
        </div>
      ) : null}
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, color: "#2D3852" }}>{title}</p>
      {hint ? (
        <p style={{ margin: "5px 0 0", fontSize: 12, color: "#9AA3B8", lineHeight: 1.45, maxWidth: 240 }}>
          {hint}
        </p>
      ) : null}
    </Motion.div>
  );
}
