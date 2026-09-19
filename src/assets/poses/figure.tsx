import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Line-figure primitives for the Recovery Flow pose drawings (YOGA-1/2).
//
// Our own drawings. Every stroke and fill is `currentColor`, so a figure
// takes the colour of its container (the app's --fg token) and follows any
// future theme. Canvas is 400 × 300 (4:3); the floor sits at y = 270.
//
// Profile figures face RIGHT and show the figure's RIGHT side as the near
// side, so a base drawing is the "R" version and side "L" is its mirror.
// Limbs on the far side of the body are drawn faint.
// ---------------------------------------------------------------------------

export const VIEW_W = 400;
export const VIEW_H = 300;
export const FLOOR_Y = 270;

const LIMB = 11;
const TORSO = 14;
const FAR_OPACITY = 0.38;

type Pt = readonly [number, number];

function d(points: readonly Pt[]): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
}

/** A limb as a polyline through its joints. */
export function Limb({ p, far = false, w = LIMB }: { p: readonly Pt[]; far?: boolean; w?: number }) {
  return (
    <path d={d(p)} fill="none" stroke="currentColor" strokeWidth={w}
          strokeLinecap="round" strokeLinejoin="round" opacity={far ? FAR_OPACITY : 1} />
  );
}

/** Neck → hip, optionally bowed through a control point (a rounded back or a backbend). */
export function Torso({ neck, hip, bow }: { neck: Pt; hip: Pt; bow?: Pt }) {
  const path = bow
    ? `M${neck[0]} ${neck[1]} Q${bow[0]} ${bow[1]} ${hip[0]} ${hip[1]}`
    : d([neck, hip]);
  return <path d={path} fill="none" stroke="currentColor" strokeWidth={TORSO}
               strokeLinecap="round" strokeLinejoin="round" />;
}

export function Head({ at, r = 17 }: { at: Pt; r?: number }) {
  return <circle cx={at[0]} cy={at[1]} r={r} fill="currentColor" />;
}

/** The mat. */
export function Floor({ from = 40, to = 360 }: { from?: number; to?: number }) {
  return <line x1={from} y1={FLOOR_Y + 8} x2={to} y2={FLOOR_Y + 8} stroke="currentColor"
               strokeWidth={4} strokeLinecap="round" opacity={0.22} />;
}

/** A curved arrow — shows a twist or a lean the figure alone can't. */
export function ArcArrow({ c, r, from, to }: { c: Pt; r: number; from: number; to: number }) {
  const rad = (a: number) => (a * Math.PI) / 180;
  const at = (a: number): Pt => [c[0] + r * Math.cos(rad(a)), c[1] + r * Math.sin(rad(a))];
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  const sweep = to > from ? 1 : 0;
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  // Arrowhead: two short strokes at the end, tangent to the arc.
  const t = rad(to) + (sweep ? Math.PI / 2 : -Math.PI / 2);
  const hx = Math.cos(t), hy = Math.sin(t);
  const back = 12, spread = 7;
  const a1: Pt = [x1 - hx * back - hy * spread, y1 - hy * back + hx * spread];
  const a2: Pt = [x1 - hx * back + hy * spread, y1 - hy * back - hx * spread];
  return (
    <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round"
       strokeLinejoin="round" opacity={0.7}>
      <path d={`M${x0} ${y0} A${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`} />
      <path d={d([a1, [x1, y1], a2])} />
    </g>
  );
}

export function Canvas({ children, title }: { children: ReactNode; title: string }) {
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label={title}
         xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      {children}
    </svg>
  );
}
