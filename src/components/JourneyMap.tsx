import { useEffect, useRef } from "react";
import type { Cursor, Section, Step } from "../lib/steps";
import { formatMMSS } from "../lib/timer";
import type { ExerciseCompletion } from "../lib/log-state";

interface Props {
  steps: Step[];
  sections: Section[];
  cursor: Cursor;
  /** Per-exercise completion derived in WorkoutScreen via buildCompletionMap.
   * Full ✓ renders only when logged >= total; partial logged shows a
   * subtle "n/m ✓" badge. */
  completion?: Map<string, ExerciseCompletion>;
  /** Portrait: render as a one-line strip until expanded. */
  collapsed?: boolean;
  /** When set, the map shows a collapse / expand toggle. */
  onToggleCollapsed?: () => void;
  /** GD-DEFER: exercises moved "later" this round (tagged until they come up). */
  deferred?: readonly string[];
}

/** Journey map listing every step of the session once. Steps inside a
 * circuit show (currentRound/total). Current step gets ›; past dims.
 * Keeps the current step in view. */
export default function JourneyMap({
  steps,
  sections,
  cursor,
  deferred = [],
  completion,
  collapsed,
  onToggleCollapsed,
}: Props) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const el = currentRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [cursor.stepIndex, collapsed]);

  const currentStep = steps[cursor.stepIndex] ?? null;

  if (collapsed) {
    return (
      <aside className="jmap jmap--collapsed" aria-label="Session journey">
        <button
          type="button"
          className="jmap-toggle"
          onClick={onToggleCollapsed}
          aria-expanded={false}
        >
          <span className="jmap-toggle-label">
            › {currentStep?.label ?? "—"}
          </span>
          <span className="jmap-toggle-meta mono">
            {cursor.stepIndex + 1}/{steps.length} ▾
          </span>
        </button>
      </aside>
    );
  }

  const sectionByStart = new Map<number, Section>();
  for (const s of sections) sectionByStart.set(s.startIndex, s);

  return (
    <aside className="jmap" aria-label="Session journey">
      {onToggleCollapsed && (
        <button type="button" className="jmap-toggle jmap-toggle--open" onClick={onToggleCollapsed} aria-expanded>
          <span className="jmap-toggle-label">Session</span>
          <span className="jmap-toggle-meta">Hide ▴</span>
        </button>
      )}
      <ol className="jmap-list">
        {steps.map((step, i) => {
          const section = sectionByStart.get(i);
          const isCurrent = i === cursor.stepIndex;
          const isPast = i < cursor.stepIndex;

          const inCurrentCircuit =
            !!step.circuitId &&
            !!currentStep?.circuitId &&
            step.circuitId === currentStep.circuitId;
          const roundLabel =
            step.circuitId && step.totalRounds && step.totalRounds > 1
              ? inCurrentCircuit
                ? `${cursor.currentRound}/${step.totalRounds}`
                : `–/${step.totalRounds}`
              : null;

          // Completion is global per exercise name.
          const exName = step.exerciseRef?.name ?? null;
          const comp = exName ? completion?.get(exName) ?? null : null;
          const isFullyLogged = !!comp && comp.logged >= comp.total;
          const isPartiallyLogged = !!comp && comp.logged > 0 && comp.logged < comp.total;

          const className =
            `jmap-row jmap-row--${step.kind}` +
            (isCurrent ? " jmap-row--current" : "") +
            (isPast && !isCurrent ? " jmap-row--past" : "") +
            (step.isRoundBreak ? " jmap-row--round-break" : "");

          return (
            <li key={i} ref={isCurrent ? currentRef : null} className="jmap-item">
              {section && (
                <div className={`jmap-section jmap-section--${section.kind}`}>
                  {section.title}
                </div>
              )}
              <div className={className}>
                <span className="jmap-arrow" aria-hidden>
                  {isCurrent ? "›" : ""}
                </span>
                <span className="jmap-dur mono">{formatMMSS(step.duration_sec)}</span>
                <span className="jmap-label">{step.label}</span>
                {roundLabel && <span className="jmap-round mono">({roundLabel})</span>}
                {step.kind === "exercise" && !isPast && !isCurrent && exName && deferred.includes(exName) && (
                  <span className="jmap-later" data-testid="jmap-later">later</span>
                )}
                {step.kind === "exercise" && isFullyLogged && (
                  <span className="jmap-check" aria-label="fully logged">✓</span>
                )}
                {step.kind === "exercise" && !isFullyLogged && isPartiallyLogged && comp && (
                  <span
                    className="jmap-partial mono"
                    aria-label={`${comp.logged} of ${comp.total} sets logged`}
                  >
                    {comp.logged}/{comp.total} ✓
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
