import { QUICK_FLAGS, type QuickFlag } from "../lib/set-notes";

interface Props {
  value: readonly QuickFlag[];
  onChange: (flags: QuickFlag[]) => void;
  disabled?: boolean;
}

/** Quick per-set flags stored in session_log.notes. Anything more detailed
 * belongs in Mattermost. */
export default function FlagChips({ value, onChange, disabled }: Props) {
  function toggle(f: QuickFlag) {
    onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  }
  return (
    <div className="flags" role="group" aria-label="Quick flags" data-no-swipe>
      <div className="chip-row chip-row--flags">
        {QUICK_FLAGS.map((f) => (
          <button
            key={f}
            type="button"
            className={`chip flag-chip${value.includes(f) ? " chip--on" : ""}`}
            aria-pressed={value.includes(f)}
            disabled={disabled}
            onClick={() => toggle(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flag-hint">Details → @artemis</div>
    </div>
  );
}
