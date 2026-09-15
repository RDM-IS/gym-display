import { useState } from "react";

// ---------------------------------------------------------------------------
// In-app numeric keypad (bottom sheet). Replaces typing into an <input>, so
// iOS never raises its keyboard for weights, reps, or machine settings.
// ---------------------------------------------------------------------------

export interface KeypadOptions {
  allowDecimal?: boolean;
  allowNegative?: boolean;
  maxLength?: number;
}

/** Apply one key to the buffer. `fresh` = the buffer still shows the prefilled
 * value, so the first digit replaces it instead of appending. */
export function applyKey(
  buf: string,
  key: string,
  fresh: boolean,
  opts: KeypadOptions = {},
): string {
  const maxLength = opts.maxLength ?? 6;
  if (key === "⌫") {
    const next = buf.slice(0, -1);
    return next === "-" ? "" : next;
  }
  if (key === "±") {
    if (!opts.allowNegative) return buf;
    return buf.startsWith("-") ? buf.slice(1) : `-${buf}`;
  }
  const base = fresh ? (buf.startsWith("-") ? "-" : "") : buf;
  if (key === ".") {
    if (!opts.allowDecimal || base.includes(".")) return base || buf;
    return `${base === "" || base === "-" ? `${base}0` : base}.`;
  }
  if (!/^\d$/.test(key)) return buf;
  if (base.replace("-", "").length >= maxLength) return base;
  const digits = base.replace("-", "");
  const sign = base.startsWith("-") ? "-" : "";
  if (digits === "0") return `${sign}${key}`;
  return `${base}${key}`;
}

export function parseBuffer(buf: string): number | null {
  if (buf === "" || buf === "-" || buf === ".") return null;
  const n = Number(buf);
  return Number.isFinite(n) ? n : null;
}

function formatInitial(v: number | null): string {
  if (v == null) return "";
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

interface Props extends KeypadOptions {
  title: string;
  unit?: string;
  initial: number | null;
  onDone: (value: number | null) => void;
  onCancel: () => void;
}

export default function NumericKeypad({
  title,
  unit,
  initial,
  onDone,
  onCancel,
  allowDecimal,
  allowNegative = true,
  maxLength,
}: Props) {
  const [buf, setBuf] = useState(() => formatInitial(initial));
  const [fresh, setFresh] = useState(true);
  const opts = { allowDecimal, allowNegative, maxLength };

  function press(key: string) {
    setBuf((b) => applyKey(b, key, fresh && key !== "⌫" && key !== "±", opts));
    setFresh(false);
    try {
      navigator.vibrate?.(10);
    } catch {
      /* no-op on iPad */
    }
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", allowDecimal ? "." : ""];

  return (
    <>
      <div className="sheet-backdrop" onClick={onCancel} />
      <div
        className="sheet sheet--keypad"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} keypad`}
        data-no-swipe
      >
        <div className="keypad-head">
          <div className="keypad-title">
            {title}
            {unit && <span className="keypad-unit"> {unit}</span>}
          </div>
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="keypad-display">
          <output className="keypad-value mono" aria-live="polite" aria-label={`${title} value`}>
            {buf === "" ? "—" : buf}
          </output>
          <button
            type="button"
            className="keypad-key keypad-key--back"
            onClick={() => press("⌫")}
            aria-label="Backspace"
          >
            ⌫
          </button>
        </div>
        <div className="keypad-grid">
          {keys.map((k, i) =>
            k === "" ? (
              <span key={`blank-${i}`} />
            ) : (
              <button
                key={k}
                type="button"
                className="keypad-key"
                onClick={() => press(k)}
                disabled={k === "±" && !allowNegative}
                aria-label={k === "±" ? "Toggle sign" : k === "." ? "Decimal point" : `Digit ${k}`}
              >
                {k}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="btn btn--primary btn--block keypad-done"
          onClick={() => onDone(parseBuffer(buf))}
        >
          Done
        </button>
      </div>
    </>
  );
}
