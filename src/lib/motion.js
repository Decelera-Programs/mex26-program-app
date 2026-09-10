// ---------------------------------------------------------------------------
// Shared motion vocabulary. Tune the whole app's feel from here — durations,
// easings and spring presets. Components import these instead of hardcoding
// numbers, so "make it slower / softer / springier" is a one-file change.
// ---------------------------------------------------------------------------

export const EASE = {
  // Gentle, expensive deceleration with a long tail (≈ easeOutExpo).
  // Default for entrances and things moving into place.
  out: [0.16, 1, 0.3, 1],
  // Symmetric — for things that both open and close (expand / collapse).
  inOut: [0.62, 0, 0.2, 1],
};

export const DUR = {
  micro: 0.18, // toggles, hovers, small menus
  base: 0.52, // card / list-item entrance
  expand: 0.52, // card expand-collapse, grow-in
  page: 0.5, // route change
};

// Physical spring with a light, tasteful settle — the default for a card or
// list item easing into place. Lower `damping` = more bounce.
export const SPRING = { type: "spring", stiffness: 210, damping: 21, mass: 1 };

// More damped — for animating height (expand / collapse / grow-in), where an
// overshoot would visibly jiggle the layout below.
export const SPRING_GENTLE = { type: "spring", stiffness: 220, damping: 30, mass: 1 };

// Snappier, for small frequent UI (dropdowns, chips, popovers).
export const SPRING_SNAP = { type: "spring", stiffness: 340, damping: 28, mass: 0.9 };

// Per-item delay for a staggered list reveal, capped so long lists don't crawl.
export const stagger = (index, step = 0.07, cap = 10) => Math.min(index, cap) * step;

// Ready-made props for the common "fade + rise into place" entrance (spring).
export const fadeUp = (distance = 18) => ({
  initial: { opacity: 0, y: distance },
  animate: { opacity: 1, y: 0 },
  transition: SPRING,
});
