import { useEffect, useRef, useState, type ReactNode } from "react";
import NumericKeypad from "./NumericKeypad";

interface Props {
  label: string;
  unit?: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** When the value is null and the user taps +/−, what to start from. */
  blankStart?: number;
  onChange: (v: number | null) => void;
  /** When non-null, shown beneath the value (e.g. "last 35 lb"). Tapping it
   * copies the value in. */
  hint?: number | null;
  /** Extra line under the value (e.g. plate math per side). */
  sub?: ReactNode;
  allowDecimal?: boolean;
  /** When set, the only values the stepper may take (ascending): −/+ move to
   * the neighbouring value and a keypad entry snaps to the nearest one. */
  values?: readonly number[] | null;
}

const HOLD_DELAY_MS = 400;
const REPEAT_START_MS = 180;
const REPEAT_MIN_MS = 50;
const REPEAT_ACCEL = 0.85;

/** Nearest allowed value (ties go to the lower one). */
export function snapTo(v: number, values: readonly number[]): number {
  let best = values[0];
  for (const x of values) {
    if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  }
  return best;
}

/** The neighbouring allowed value in the direction of `delta`. */
export function stepThrough(cur: number, delta: number, values: readonly number[]): number {
  if (delta > 0) return values.find((x) => x > cur) ?? values[values.length - 1];
  for (let i = values.length - 1; i >= 0; i--) if (values[i] < cur) return values[i];
  return values[0];
}

export function clampRound(v: number, min?: number, max?: number): number {
  let next = v;
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  // 1-decimal rounding so 2.5-lb steps don't accumulate FP drift.
  return Math.round(next * 10) / 10;
}

/** Big −/+ stepper for touch. The value is a button that opens the in-app
 * numeric keypad — never an <input>, so the iOS keyboard never appears.
 * Press-and-hold on −/+ repeats with acceleration. */
export default function Stepper({
  label,
  unit,
  value,
  step,
  min,
  max,
  disabled,
  blankStart,
  onChange,
  hint,
  sub,
  allowDecimal,
  values,
}: Props) {
  const allowed = values && values.length > 0 ? values : null;
  const [keypadOpen, setKeypadOpen] = useState(false);
  const valueRef = useRef(value);
  valueRef.current = value;
  const repeatRef = useRef<number | null>(null);

  function stopRepeat() {
    if (repeatRef.current !== null) {
      window.clearTimeout(repeatRef.current);
      repeatRef.current = null;
    }
  }
  useEffect(() => stopRepeat, []);

  function bump(delta: number) {
    if (disabled || step === 0) return;
    const cur = valueRef.current;
    // First tap on an empty value reveals the suggested default rather than
    // overshooting it by `step`.
    let next: number;
    if (allowed) {
      next = cur == null ? snapTo(blankStart ?? allowed[0], allowed) : stepThrough(cur, delta, allowed);
    } else {
      next = cur == null ? clampRound(blankStart ?? 0, min, max) : clampRound(cur + delta, min, max);
    }
    valueRef.current = next;
    onChange(next);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* no-op on iPad */
    }
  }

  function startRepeat(delta: number) {
    stopRepeat();
    bump(delta);
    let interval = REPEAT_START_MS;
    const tick = () => {
      bump(delta);
      interval = Math.max(REPEAT_MIN_MS, interval * REPEAT_ACCEL);
      repeatRef.current = window.setTimeout(tick, interval);
    };
    repeatRef.current = window.setTimeout(tick, HOLD_DELAY_MS);
  }

  function holdHandlers(delta: number) {
    return {
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        // Only the primary button (or touch/pen, which report 0 or nothing).
        if (e.button > 0) return;
        startRepeat(delta);
      },
      onPointerUp: stopRepeat,
      onPointerLeave: stopRepeat,
      onPointerCancel: stopRepeat,
      // Pointer taps already bumped on pointerdown; keyboard / assistive
      // activation arrives as a click with detail 0.
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (e.detail === 0) bump(delta);
      },
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    };
  }

  return (
    <div className={`stepper${disabled ? " stepper--disabled" : ""}`} data-no-swipe>
      <div className="stepper-label">
        {label}
        {unit && <span className="stepper-unit"> {unit}</span>}
      </div>
      <div className="stepper-row">
        <button
          className="stepper-btn"
          type="button"
          disabled={disabled || step === 0}
          aria-label={`Decrease ${label}`}
          {...holdHandlers(-step)}
        >
          −
        </button>
        <button
          type="button"
          className="stepper-value mono"
          disabled={disabled}
          onClick={() => setKeypadOpen(true)}
          aria-label={`${label} ${value == null ? "not set" : prettyNum(value)}${unit ? ` ${unit}` : ""}, tap to enter`}
        >
          {value == null ? "—" : prettyNum(value)}
        </button>
        <button
          className="stepper-btn"
          type="button"
          disabled={disabled || step === 0}
          aria-label={`Increase ${label}`}
          {...holdHandlers(step)}
        >
          +
        </button>
      </div>
      {sub && <div className="stepper-sub">{sub}</div>}
      {hint != null && value == null && !disabled && (
        <button
          type="button"
          className="stepper-hint"
          onClick={() => onChange(hint)}
          aria-label={`Use last value ${hint}`}
        >
          last {prettyNum(hint)}
          {unit ? ` ${unit}` : ""}
        </button>
      )}
      {keypadOpen && (
        <NumericKeypad
          title={label}
          unit={unit}
          initial={value}
          allowDecimal={allowDecimal}
          allowNegative={min === undefined || min < 0}
          onCancel={() => setKeypadOpen(false)}
          onDone={(v) => {
            setKeypadOpen(false);
            onChange(v == null ? null : allowed ? snapTo(v, allowed) : clampRound(v, min, max));
          }}
        />
      )}
    </div>
  );
}

function prettyNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}
