// Shared hero-card decoration: the eight-petal rosette carved into the
// wooden Decelera México venue sign, redrawn as line art. Ties the app back
// to the program's real physical branding instead of a generic "Mexican"
// motif. Design source: Claude Design handoff "Diseño PWA Mesoamericana",
// frame 3A. Renders in `currentColor` — wrap it in an element that sets
// `color` and (for the breathe animation) the `decelera-mx-mark` class.
export default function DeceleraRosetteMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="-100 -100 200 200"
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <g id="dc-ro-petal">
          <path d="M 0 -99 C 14 -86 22 -74 22 -64 C 22 -52 12 -46 0 -46 C -12 -46 -22 -52 -22 -64 C -22 -74 -14 -86 0 -99 Z" />
          <path
            d="M 0 -92 C 10 -82.5 16 -73.5 16 -65 C 16 -56.5 9 -51.5 0 -51.5 C -9 -51.5 -16 -56.5 -16 -65 C -16 -73.5 -10 -82.5 0 -92 Z"
            strokeWidth="2.4"
            strokeDasharray="0.1 5.6"
          />
          <path d="M -7.5 -60 Q 0 -80 7.5 -60" />
          <path d="M -3.8 -60 Q 0 -72 3.8 -60" />
          <circle cx="0" cy="-57" r="2.6" />
          <path d="M -11 -62 Q -8.5 -57 -11.5 -55" />
          <path d="M 11 -62 Q 8.5 -57 11.5 -55" />
        </g>
        <path id="dc-ro-spike" d="M -3.4 -50 L 0 -63 L 3.4 -50" />
        <g id="dc-ro-paren">
          <path d="M -4.6 -44.5 Q -8.8 -39 -4.6 -33.5" />
          <path d="M 4.6 -44.5 Q 8.8 -39 4.6 -33.5" />
        </g>
        <path id="dc-ro-moon" d="M -2.6 -44.5 Q 4.6 -39 -2.6 -33.5" strokeWidth="2.4" />
      </defs>

      <g>
        <use href="#dc-ro-petal" />
        <use href="#dc-ro-petal" transform="rotate(45)" />
        <use href="#dc-ro-petal" transform="rotate(90)" />
        <use href="#dc-ro-petal" transform="rotate(135)" />
        <use href="#dc-ro-petal" transform="rotate(180)" />
        <use href="#dc-ro-petal" transform="rotate(225)" />
        <use href="#dc-ro-petal" transform="rotate(270)" />
        <use href="#dc-ro-petal" transform="rotate(315)" />
      </g>

      <g>
        <use href="#dc-ro-spike" transform="rotate(22.5)" />
        <use href="#dc-ro-spike" transform="rotate(67.5)" />
        <use href="#dc-ro-spike" transform="rotate(112.5)" />
        <use href="#dc-ro-spike" transform="rotate(157.5)" />
        <use href="#dc-ro-spike" transform="rotate(202.5)" />
        <use href="#dc-ro-spike" transform="rotate(247.5)" />
        <use href="#dc-ro-spike" transform="rotate(292.5)" />
        <use href="#dc-ro-spike" transform="rotate(337.5)" />
      </g>

      <circle cx="0" cy="0" r="49" />
      <circle cx="0" cy="0" r="46" />
      <circle cx="0" cy="0" r="32" />

      <g>
        <use href="#dc-ro-paren" />
        <use href="#dc-ro-moon" transform="rotate(30)" />
        <use href="#dc-ro-paren" transform="rotate(60)" />
        <use href="#dc-ro-moon" transform="rotate(90)" />
        <use href="#dc-ro-paren" transform="rotate(120)" />
        <use href="#dc-ro-moon" transform="rotate(150)" />
        <use href="#dc-ro-paren" transform="rotate(180)" />
        <use href="#dc-ro-moon" transform="rotate(210)" />
        <use href="#dc-ro-paren" transform="rotate(240)" />
        <use href="#dc-ro-moon" transform="rotate(270)" />
        <use href="#dc-ro-paren" transform="rotate(300)" />
        <use href="#dc-ro-moon" transform="rotate(330)" />
      </g>

      <g strokeWidth="8" transform="rotate(-22)">
        <path d="M 19.94 9.3 A 22 22 0 0 1 -19.94 9.3" />
        <path d="M -19.94 -9.3 A 22 22 0 0 1 19.94 -9.3" />
      </g>
    </svg>
  );
}
