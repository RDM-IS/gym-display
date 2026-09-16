export const RPE_WHOLE = [5, 6, 7, 8, 9, 10] as const;
export const RPE_HALF = [5.5, 6.5, 7.5, 8.5, 9.5] as const;

interface Props {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  label?: string;
}

/** RPE as tap chips — whole numbers on the main row, half steps on a second
 * row. Tapping the selected chip clears it. */
export default function RpeChips({ value, onChange, disabled, label = "RPE" }: Props) {
  const chip = (n: number, half: boolean) => (
    <button
      key={n}
      type="button"
      className={`chip rpe-chip${half ? " rpe-chip--half" : ""}${value === n ? " chip--on" : ""}`}
      aria-pressed={value === n}
      aria-label={`${label} ${n}`}
      disabled={disabled}
      onClick={() => onChange(value === n ? null : n)}
    >
      {half ? n.toFixed(1) : n}
    </button>
  );
  return (
    <div className="rpe" role="group" aria-label={label} data-no-swipe>
      <div className="chip-label">{label}</div>
      <div className="chip-row chip-row--rpe">{RPE_WHOLE.map((n) => chip(n, false))}</div>
      <div className="chip-row chip-row--half">{RPE_HALF.map((n) => chip(n, true))}</div>
    </div>
  );
}
