import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion as Motion, animate, useMotionValue, useMotionValueEvent, useTransform } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EASE, SPRING, SPRING_SNAP } from "../lib/motion";

// ---------------------------------------------------------------------------
// Horizontal swipe between detail pages (person / startup). The page follows
// the finger with a slight tilt + scale, a "peek" chip with the neighbour
// slides in from the edge, and past the threshold the page flies out and the
// next one springs in from the opposite side (`enterFrom`).
// Vertical scrolling is untouched: drag is locked to the x axis (pan-y).
// ---------------------------------------------------------------------------

const COMMIT_RATIO = 0.26; // share of the screen width to commit
const COMMIT_VELOCITY = 520; // px/s — a quick flick commits too
const HINT_KEY = "decelera.swipe.hinted";

function screenWidth() {
  return Math.min(window.innerWidth || 390, 440);
}

function PeekChip({ item, side, x, armed }) {
  const isNext = side === "next";
  const opacity = useTransform(x, isNext ? [-150, -24] : [24, 150], isNext ? [1, 0] : [0, 1]);
  const shift = useTransform(x, isNext ? [-150, 0] : [0, 150], isNext ? [0, 28] : [-28, 0]);
  const Icon = isNext ? ChevronRight : ChevronLeft;

  return (
    <Motion.div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: "46%",
        [isNext ? "right" : "left"]: "max(10px, calc((100vw - 440px) / 2 + 10px))",
        zIndex: 90,
        opacity,
        x: shift,
        pointerEvents: "none",
      }}
    >
      <Motion.div
        animate={{
          scale: armed ? 1.06 : 1,
          backgroundColor: armed ? "#2D3852" : "rgba(255,255,255,0.96)",
          color: armed ? "#FFFFFF" : "#2D3852",
        }}
        transition={SPRING_SNAP}
        style={{
          display: "flex",
          flexDirection: isNext ? "row" : "row-reverse",
          alignItems: "center",
          gap: 8,
          padding: isNext ? "6px 8px 6px 6px" : "6px 6px 6px 8px",
          borderRadius: 999,
          boxShadow: "0 10px 26px rgba(45,56,82,0.18)",
          border: "1px solid rgba(45,56,82,0.06)",
          maxWidth: 190,
        }}
      >
        <div
          style={{
            width: 30,
            height: 30,
            minWidth: 30,
            borderRadius: 999,
            overflow: "hidden",
            background: "#EDF1F4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#2D3852",
          }}
        >
          {item.image ? (
            <img
              src={item.image}
              alt=""
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", objectFit: item.imageFit || "cover", display: "block" }}
            />
          ) : (
            item.initials
          )}
        </div>
        <div style={{ minWidth: 0, textAlign: isNext ? "left" : "right" }}>
          <p style={{ margin: 0, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6 }}>
            {isNext ? "Next" : "Previous"}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {item.label}
          </p>
        </div>
        <Icon size={16} style={{ flex: "0 0 auto", opacity: 0.7 }} />
      </Motion.div>
    </Motion.div>
  );
}

export default function SwipePager({ prev, next, onNavigate, enterFrom, disabled = false, children }) {
  const enterOffset = enterFrom === "next" ? 1 : enterFrom === "prev" ? -1 : 0;
  const x = useMotionValue(enterOffset * screenWidth() * 0.55);
  const rotate = useTransform(x, [-400, 0, 400], [-2.5, 0, 2.5]);
  const scale = useTransform(x, [-400, 0, 400], [0.94, 1, 0.94]);
  const opacity = useTransform(x, [-480, -140, 0, 140, 480], [0, 0.9, 1, 0.9, 0]);
  const [armed, setArmed] = useState(null); // "next" | "prev" | null
  const committing = useRef(false);
  const dragged = useRef(false);

  // Entrance after a swipe: spring in from the side the user swiped towards.
  useEffect(() => {
    if (!enterOffset) return;
    const controls = animate(x, 0, SPRING);
    return () => controls.stop();
  }, [enterOffset, x]);

  // One-time nudge per session so the gesture is discoverable: the page
  // leans left for a moment, revealing the "Next" chip, then settles back.
  useEffect(() => {
    if (enterOffset || !next || disabled) return;
    try {
      if (sessionStorage.getItem(HINT_KEY)) return;
      sessionStorage.setItem(HINT_KEY, "1");
    } catch {
      return;
    }
    let controls;
    const timer = setTimeout(() => {
      controls = animate(x, [0, -78, 0], { duration: 1.25, times: [0, 0.4, 1], ease: EASE.inOut });
    }, 900);
    return () => {
      clearTimeout(timer);
      controls?.stop();
    };
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useMotionValueEvent(x, "change", (value) => {
    if (committing.current) return;
    const threshold = screenWidth() * COMMIT_RATIO;
    const nextArmed = value < -threshold && next ? "next" : value > threshold && prev ? "prev" : null;
    if (nextArmed !== armed) {
      if (nextArmed) navigator.vibrate?.(6);
      setArmed(nextArmed);
    }
  });

  function handleDragStart() {
    dragged.current = true;
  }

  function handleDragEnd(_, info) {
    const w = screenWidth();
    const { x: dx } = info.offset;
    const { x: vx } = info.velocity;
    const goNext = next && (dx < -w * COMMIT_RATIO || (vx < -COMMIT_VELOCITY && dx < -40));
    const goPrev = prev && (dx > w * COMMIT_RATIO || (vx > COMMIT_VELOCITY && dx > 40));

    // Let the click that follows the pointer-up be swallowed, then re-arm.
    setTimeout(() => { dragged.current = false; }, 0);

    if (!goNext && !goPrev) {
      animate(x, 0, SPRING_SNAP);
      return;
    }

    committing.current = true;
    const direction = goNext ? "next" : "prev";
    const target = goNext ? next : prev;
    animate(x, (goNext ? -1 : 1) * w * 1.15, {
      type: "tween",
      duration: 0.24,
      ease: [0.4, 0, 1, 1],
      onComplete: () => onNavigate(target, direction),
    });
  }

  return (
    <>
      <Motion.div
        drag={disabled ? false : "x"}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: next ? 0.9 : 0.12, right: prev ? 0.9 : 0.12 }}
        dragMomentum={false}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClickCapture={(e) => {
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={{ x, rotate, scale, opacity, transformOrigin: "50% 220px" }}
      >
        {children}
      </Motion.div>
      {!disabled && typeof document !== "undefined" &&
        createPortal(
          <>
            {next ? <PeekChip item={next} side="next" x={x} armed={armed === "next"} /> : null}
            {prev ? <PeekChip item={prev} side="prev" x={x} armed={armed === "prev"} /> : null}
          </>,
          document.body,
        )}
    </>
  );
}
