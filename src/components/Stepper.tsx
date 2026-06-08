interface Props {
  label: string;
  unit?: string;
  value: number | null;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  /** When the value is null and the user taps +, what to start from. */
  blankStart?: number;
  onChange: (v: number | null) => void;
  /** When non-null, displayed as a small placeholder beneath the value
   * (e.g. "last 35 lb"). Tapping it copies the placeholder into value. */
  hint?: number | null;
}

/** Big +/- stepper. Touch targets clamp(56px, 7vw, 96px); number is huge. */
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
}: Props) {
  function bump(delta: number) {
    if (disabled) return;
    if (value == null) {
      // First tap reveals the suggested default (blankStart) so the
      // user sees the suggestion and can refine from there rather than
      // overshooting by `step` immediately.
      let next = blankStart ?? 0;
      if (min !== undefined && next < min) next = min;
      if (max !== undefined && next > max) next = max;
      onChange(Math.round(next * 10) / 10);
      return;
    }
    let next = value + delta;
    if (min !== undefined && next < min) next = min;
    if (max !== undefined && next > max) next = max;
    // Round to 1 decimal so 2.5-step weights don't accumulate FP drift
    next = Math.round(next * 10) / 10;
    onChange(next);
  }

  function applyHint() {
    if (disabled || hint == null) return;
    onChange(hint);
  }

  return (
    <div className={`stepper${disabled ? " stepper--disabled" : ""}`}>
      <div className="stepper-label">
        {label}
        {unit && <span className="stepper-unit"> {unit}</span>}
      </div>
      <div className="stepper-row">
        <button
          className="stepper-btn"
          type="button"
          onClick={() => bump(-step)}
          disabled={disabled || step === 0}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <div className="stepper-value tv-mono" aria-live="polite">
          {value == null ? "—" : prettyNum(value)}
        </div>
        <button
          className="stepper-btn"
          type="button"
          onClick={() => bump(step)}
          disabled={disabled || step === 0}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {hint != null && value == null && !disabled && (
        <button
          type="button"
          className="stepper-hint"
          onClick={applyHint}
          aria-label={`Use last value ${hint}`}
        >
          last {prettyNum(hint)}{unit ? ` ${unit}` : ""}
        </button>
      )}
    </div>
  );
}

function prettyNum(n: number): string {
  // Drop trailing .0 to keep the big number visually clean.
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}
