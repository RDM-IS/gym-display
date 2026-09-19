import { Canvas, VIEW_W } from "./figure";
import { DRAWINGS } from "./drawings";

// ---------------------------------------------------------------------------
// YOGA-2 — pose illustrations for the Recovery Flow.
//
// Lookup is by the pose name as the plan writes it ("High lunge"), so the
// artemis seed and the drawings stay in step. A pose listed in TEXT_ONLY
// (a drawing that didn't read clearly) — or one with no drawing at all —
// gets no figure and the screen falls back to the text-only layout.
// ---------------------------------------------------------------------------

/** Poses deliberately shown text-only, with the reason. Empty = all drawn. */
export const TEXT_ONLY: Record<string, string> = {};

export function poseKey(name: string): string {
  return name.trim().toLowerCase();
}

export function hasPoseArt(name: string): boolean {
  const k = poseKey(name);
  return k in DRAWINGS && !(k in TEXT_ONLY);
}

export function isSidedArt(name: string): boolean {
  return hasPoseArt(name) && DRAWINGS[poseKey(name)].sided;
}

interface Props {
  name: string;
  side?: "R" | "L" | null;
  className?: string;
}

/** The figure for a pose, or null when it has none (text-only fallback). */
export default function PoseFigure({ name, side = null, className }: Props) {
  if (!hasPoseArt(name)) return null;
  const drawing = DRAWINGS[poseKey(name)];
  const mirrored = drawing.sided && side === "L";
  const title = side ? `${name} (${side === "L" ? "left" : "right"})` : name;
  return (
    <div className={className ? `pose-figure ${className}` : "pose-figure"}
         data-testid="pose-figure" data-pose={poseKey(name)} data-mirrored={mirrored}>
      <Canvas title={title}>
        {mirrored
          ? <g transform={`translate(${VIEW_W} 0) scale(-1 1)`}>{drawing.art()}</g>
          : drawing.art()}
      </Canvas>
    </div>
  );
}
