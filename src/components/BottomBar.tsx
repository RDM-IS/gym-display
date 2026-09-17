import { BAR_LABELS, barShowsStart, barTargets, type BarTarget, type BarView } from "../lib/bottom-bar";

interface Props {
  view: BarView;
  onNavigate: (target: BarTarget) => void;
  /** Today only: the primary action in the left slot. */
  start?: { label: string; onStart: () => void } | null;
}

/** GD-NAV — fixed bottom bar. Content scrolls behind it; screens reserve
 * `var(--bottom-bar-h)` of bottom padding so the last item clears it. */
export default function BottomBar({ view, onNavigate, start }: Props) {
  const showStart = barShowsStart(view) && !!start;
  return (
    <nav className="bottom-bar" aria-label="Views" data-testid="bottom-bar" data-view={view}>
      <div className="bottom-bar-left">
        {showStart && (
          <button type="button" className="btn btn--primary bottom-bar-start" onClick={start!.onStart}>
            {start!.label}
          </button>
        )}
      </div>
      <div className="bottom-bar-right">
        {barTargets(view).map((t) => (
          <button
            key={t}
            type="button"
            className="btn bottom-bar-btn"
            data-target={t}
            onClick={() => onNavigate(t)}
          >
            {BAR_LABELS[t]}
          </button>
        ))}
      </div>
    </nav>
  );
}
