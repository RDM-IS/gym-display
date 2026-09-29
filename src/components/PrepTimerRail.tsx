import type { Task } from "../lib/prep-schedule";
import { fmtCountdown } from "../lib/prep-session";

export interface RailEntry {
  task: Task;
  remainingMs: number;
}

/** The timer rail: one live countdown per running task, pinned above the board.
 *
 * ANY NUMBER AT ONCE — the acceptance criterion is four, and there is no cap here
 * because the kitchen decides, not the layout. An expired timer reads 0:00 and
 * HOLDS, flashing, until he taps Done: the food leaves the oven when he takes it
 * out, not when a number reaches zero, and a timer that cleared itself would throw
 * away the only signal that something is waiting.
 *
 * The visual alarm is not a nicety. iOS will not play a sound from a backgrounded
 * tab, so a chime alone can be silently lost — the flash is what still works.
 */
export default function PrepTimerRail(
  { entries, onDone }: { entries: RailEntry[]; onDone: (task: Task) => void },
) {
  if (entries.length === 0) {
    return (
      <div className="prep-rail prep-rail--empty">
        <span className="muted">No timers running.</span>
      </div>
    );
  }
  return (
    <div className="prep-rail" role="list" aria-label="Running timers">
      {entries.map(({ task, remainingMs }) => {
        const expired = remainingMs <= 0;
        return (
          <button
            key={task.key}
            role="listitem"
            className={`prep-timer prep-timer--${task.resource}${expired ? " is-expired" : ""}`}
            onClick={() => onDone(task)}
            aria-label={`${task.name}, ${expired ? "finished" : fmtCountdown(remainingMs)}`}
          >
            <span className="prep-timer-time">{fmtCountdown(remainingMs)}</span>
            <span className="prep-timer-name">{task.name}</span>
            <span className="prep-timer-hint">{expired ? "tap = done" : task.resource}</span>
          </button>
        );
      })}
    </div>
  );
}
