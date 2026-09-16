import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export type SwipeDirection = "left" | "right";

const MIN_DX = 60;
const MAX_MS = 700;

/** Pure classifier: a quick, mostly-horizontal drag of ≥60px. */
export function detectSwipe(dx: number, dy: number, dtMs: number): SwipeDirection | null {
  if (dtMs > MAX_MS) return null;
  if (Math.abs(dx) < MIN_DX) return null;
  if (Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  return dx < 0 ? "left" : "right";
}

/** Horizontal swipe on an element. Gestures that start inside
 * [data-no-swipe] (steppers, chips, keypad) are ignored. Pair with
 * `touch-action: pan-y` on the element. */
export function useSwipe(onSwipe: (dir: SwipeDirection) => void) {
  const start = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  return {
    onPointerDown(e: ReactPointerEvent<HTMLElement>) {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-no-swipe]")) {
        start.current = null;
        return;
      }
      start.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    },
    onPointerUp(e: ReactPointerEvent<HTMLElement>) {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dir = detectSwipe(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (dir) onSwipe(dir);
    },
    onPointerCancel() {
      start.current = null;
    },
  };
}
