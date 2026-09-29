import { moveFor } from "./moves";
import { VIEW_H, VIEW_W } from "../poses/figure";

// A movement figure as a 2-key-frame CSS loop. Both frames are in the DOM and
// CSS alternates their opacity — no JS timer, so it cannot drift from the
// session clock or keep running when the screen is hidden.
//
// prefers-reduced-motion pins frame 1 (see styles/circuit.css). A looping
// animation is the one thing that setting exists for, and a workout screen is
// exactly where someone who needs it will be looking.

export default function MoveFigure({ name, className }: { name: string; className?: string }) {
  const move = moveFor(name);
  if (!move) return null;
  return (
    <svg
      className={`move-figure ${className ?? ""}`}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label={name}
      data-testid="move-figure"
      data-move={name}
      style={{ ["--move-cycle" as string]: `${move.cycle}s` }}
    >
      {move.frames.map((frame, i) => (
        <g key={i} className={`move-frame move-frame--${i}`} data-frame={i}>
          {frame()}
        </g>
      ))}
    </svg>
  );
}
