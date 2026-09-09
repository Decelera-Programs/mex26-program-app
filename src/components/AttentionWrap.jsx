// Wraps a Home card in the "needs your attention" treatment (float + cyan glow,
// see .dc-attn in index.css) while `pulse` is true. The wrapper <div> is always
// rendered so toggling `pulse` never remounts the child (which would drop the
// card's own state); when `pulse` is false it's a plain, style-less block that
// behaves exactly like the card sitting directly in the layout.
export default function AttentionWrap({ pulse, children }) {
  return (
    <div className={pulse ? "dc-attn" : undefined}>
      {pulse ? <span className="dc-attn-glow" aria-hidden="true" /> : null}
      {children}
    </div>
  );
}
