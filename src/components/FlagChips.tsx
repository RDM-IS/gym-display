import { useState } from "react";
import {
  PAIN_LEVELS,
  PAIN_REGIONS,
  QUICK_FLAGS,
  upsertPain,
  type PainEntry,
  type PainRegion,
  type QuickFlag,
} from "../lib/set-notes";

interface Props {
  value: readonly QuickFlag[];
  onChange: (flags: QuickFlag[]) => void;
  /** In-session pain for this set (`pain=<region>:<n>` in the notes). */
  pain?: readonly PainEntry[];
  onPainChange?: (pain: PainEntry[]) => void;
  disabled?: boolean;
}

/** Quick per-set flags stored in session_log.notes. Anything more detailed
 * belongs in Mattermost.
 *
 * The Pain chip opens a picker: tap a region, then a 0–5 rating — no keyboard.
 * Several regions can be added; tapping a region again re-rates it. */
export default function FlagChips({ value, onChange, pain = [], onPainChange, disabled }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [region, setRegion] = useState<PainRegion | null>(null);

  function toggle(f: QuickFlag) {
    onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  }

  function rate(level: number) {
    if (!region || !onPainChange) return;
    onPainChange(upsertPain(pain, { region, level }));
    setRegion(null);
    setPickerOpen(false);
  }

  function closePicker() {
    setRegion(null);
    setPickerOpen(false);
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
        {onPainChange && (
          <button
            type="button"
            className={`chip flag-chip pain-chip${pain.length > 0 || pickerOpen ? " chip--on" : ""}`}
            aria-pressed={pain.length > 0}
            aria-expanded={pickerOpen}
            data-testid="pain-chip"
            disabled={disabled}
            onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
          >
            pain{pain.length > 0 ? ` (${pain.length})` : ""}
          </button>
        )}
      </div>

      {pain.length > 0 && (
        <div className="pain-entries" data-testid="pain-entries">
          {pain.map((p) => (
            <button
              key={p.region}
              type="button"
              className="chip pain-entry chip--on"
              disabled={disabled}
              aria-label={`Remove pain ${p.region} ${p.level}`}
              onClick={() => onPainChange?.(pain.filter((x) => x.region !== p.region))}
            >
              {p.region} {p.level} ✕
            </button>
          ))}
        </div>
      )}

      {pickerOpen && !disabled && (
        <div className="pain-picker" role="group" aria-label="Pain" data-testid="pain-picker">
          <div className="chip-label">Where?</div>
          <div className="chip-row chip-row--regions">
            {PAIN_REGIONS.map((r) => (
              <button
                key={r}
                type="button"
                className={`chip region-chip${region === r ? " chip--on" : ""}`}
                aria-pressed={region === r}
                onClick={() => setRegion(r)}
              >
                {r}
              </button>
            ))}
          </div>
          <div className="chip-label">
            How bad? <span className="dim">0 none · 5 can't use it</span>
          </div>
          <div className="chip-row chip-row--rpe">
            {PAIN_LEVELS.map((n) => (
              <button
                key={n}
                type="button"
                className="chip"
                disabled={region === null}
                aria-label={`Pain ${n}`}
                onClick={() => rate(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <button type="button" className="chip pain-cancel" onClick={closePicker}>
            cancel
          </button>
        </div>
      )}

      <div className="flag-hint">Details → @artemis</div>
    </div>
  );
}
