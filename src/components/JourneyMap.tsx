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
   * subtle "(n/m ✓)" badge so the user sees progress, not a misleading
   * ✓ after just set 1. */
  completion?: Map<string, ExerciseCompletion>;
}

/** Vertical journey map. Always-visible right panel listing every step
 * of the session once. Steps inside a circuit show (currentRound/total).
 * Current step gets ›; past dims; upcoming normal. Auto-scrolls the
 * current step into view. */
export default function JourneyMap({ steps, sections, cursor, completion }: Props) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const el = currentRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [cursor.stepIndex]);

  const sectionByStart = new Map<number, Section>();
  for (const s of sections) sectionByStart.set(s.startIndex, s);

  const currentStep = steps[cursor.stepIndex] ?? null;

  return (
    <aside className="jmap" aria-label="Session journey">
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

          const dim = isPast && !isCurrent;

          // Per-set completion badge. The same exercise (Goblet squat)
          // can appear in multiple steps (one row per circuit body
          // exercise) but its completion is global — we look up by name.
          const exName = step.exerciseRef?.name ?? null;
          const comp = exName ? completion?.get(exName) ?? null : null;
          const isFullyLogged = !!comp && comp.logged >= comp.total;
          const isPartiallyLogged = !!comp && comp.logged > 0 && comp.logged < comp.total;

          const className =
            `jmap-row jmap-row--${step.kind}` +
            (isCurrent ? " jmap-row--current" : "") +
            (dim ? " jmap-row--past" : "") +
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
                <span className="jmap-dur tv-mono">{formatMMSS(step.duration_sec)}</span>
                <span className="jmap-label">{step.label}</span>
                {roundLabel && <span className="jmap-round tv-mono">({roundLabel})</span>}
                {step.kind === "exercise" && isFullyLogged && (
                  <span className="jmap-check" aria-label="fully logged">✓</span>
                )}
                {step.kind === "exercise" && !isFullyLogged && isPartiallyLogged && comp && (
                  <span
                    className="jmap-partial tv-mono"
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
