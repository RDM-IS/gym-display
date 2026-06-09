import { useEffect, useRef } from "react";
import type { Cursor, Section, Step } from "../lib/steps";
import { formatMMSS } from "../lib/timer";

interface Props {
  steps: Step[];
  sections: Section[];
  cursor: Cursor;
  /** Names of exercises already logged today — rendered with ✓ in the map. */
  loggedExercises?: Set<string>;
}

/** Vertical journey map. Always-visible right panel listing every step
 * of the session once. Steps inside a circuit show (currentRound/total).
 * Current step gets >> + highlight; past dim; upcoming normal. Auto-
 * scrolls the current step into view on cursor change. */
export default function JourneyMap({ steps, sections, cursor, loggedExercises }: Props) {
  const currentRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const el = currentRef.current;
    // jsdom lacks scrollIntoView; guard so tests + non-Chromium clients work.
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [cursor.stepIndex]);

  // Build a quick lookup from step index → section so we know where to
  // insert section headers.
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

          // Round counter follows the cursor: shown only on circuit
          // steps that are part of the SAME circuit the cursor is in.
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
          const exName = step.exerciseRef?.name ?? null;
          const isLogged = exName ? loggedExercises?.has(exName) ?? false : false;

          const className =
            `jmap-row jmap-row--${step.kind}` +
            (isCurrent ? " jmap-row--current" : "") +
            (dim ? " jmap-row--past" : "") +
            (step.isRoundBreak ? " jmap-row--round-break" : "");

          return (
            <li
              key={i}
              ref={isCurrent ? currentRef : null}
              className="jmap-item"
            >
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
                {isLogged && step.kind === "exercise" && (
                  <span className="jmap-check" aria-label="logged">✓</span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
