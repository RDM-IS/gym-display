import type { CSSProperties } from "react";
import { repsLeftHint } from "../lib/strength-cues";
import type { LastLoggedEntry } from "../lib/types";

// GD-DISTANCE (Ryan, 2026-09-21) — the active-set screen, readable from ~20 ft.
//
// Three tiles across the top: REPS, RPE, LAST. Each numeral is sized to fill
// its own tile's width (container query units), because on this screen WIDTH
// is the binding constraint, not height — see the sizing notes in workout.css.
//
// Two rules that keep the screen from jumping:
//   * all three tiles ALWAYS render, with every line present (an empty line is
//     a non-breaking space), so /last_logged arriving a moment late — or not at
//     all — never reflows the tiles;
//   * the numeral's size depends on its tile's width and its character count,
//     never on the value itself, so 9 → 10 reps can't change the layout.
//
// LAST is the single most recent set, straight from /last_logged. It is NOT
// the spoken "your last sets averaged" (GD-STRENGTH-CUES) — that average is for
// the voice only, and the top set is what you load the bar against.

// The digit width itself (--digit-em) and every size derived from it live in
// workout.css, so there is one number to tune. This file only reports how
// many characters each numeral needs room for.

/** Width budget of the small "lb" suffix, in digit-widths. */
const UNIT_CHARS = 0.9;
/** Size numbers as if they had at least this many characters, so a
 * single-digit "6" renders the same size as "12" beside it instead of huge. */
const MIN_CHARS = 2;

function charCount(text: string, extra = 0): number {
  return Math.max(MIN_CHARS, text.replace(/[^0-9.]/g, "").length) + extra;
}

function numStyle(chars: number): CSSProperties {
  return { "--chars": String(chars) } as CSSProperties;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

const NBSP = " ";

interface Props {
  /** Target reps for this set. Null → "—". */
  reps: number | null;
  /** The RPE cap in force: exercise, then session. Null → "—". */
  cap: number | null;
  /** The most recent logged set of this exercise (/last_logged). */
  last: LastLoggedEntry | null;
}

export default function StrengthTiles({ reps, cap, last }: Props) {
  const repsText = reps != null ? String(reps) : "—";
  const capText = cap != null ? fmt(cap) : "—";
  const repsLeft = repsLeftHint(cap);

  const hasWeight = last?.weight_lbs != null;
  const lastText = hasWeight ? fmt(last!.weight_lbs!) : last ? "BW" : "—";
  const lastSub = last
    ? [last.reps_done != null ? `×${last.reps_done}` : null,
       last.rpe_actual != null ? `RPE ${fmt(last.rpe_actual)}` : null]
        .filter(Boolean).join(" · ") || NBSP
    : "first time";

  return (
    <div className="stiles" data-testid="strength-tiles">
      <section className="stile" data-testid="tile-reps" aria-label={`Target reps ${repsText}`}>
        <div className="stile-label">Reps</div>
        <div className="stile-num" style={numStyle(charCount(repsText))}>{repsText}</div>
        <div className="stile-sub">{NBSP}</div>
      </section>

      <section className="stile" data-testid="tile-rpe" aria-label={`RPE cap ${capText}`}>
        <div className="stile-label">RPE</div>
        <div className="stile-num" style={numStyle(charCount(capText))}>{capText}</div>
        <div className="stile-sub" data-testid="tile-rpe-sub">{repsLeft ?? NBSP}</div>
      </section>

      <section className="stile stile--last" data-testid="tile-last"
               aria-label={`Last set ${hasWeight ? `${lastText} pounds` : lastText}`}>
        <div className="stile-label">Last</div>
        <div className="stile-num"
             style={numStyle(charCount(lastText, hasWeight ? UNIT_CHARS : 0))}>
          {lastText}
          {hasWeight && <span className="stile-unit">lb</span>}
        </div>
        <div className="stile-sub" data-testid="tile-last-sub">{lastSub}</div>
      </section>
    </div>
  );
}
