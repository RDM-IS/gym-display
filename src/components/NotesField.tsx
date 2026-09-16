import { scrollIntoViewWhenSettled } from "../lib/viewport";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

/** The one free-text field left (session-summary notes). Keyboard-safe:
 * ≥16px text so iOS doesn't focus-zoom, and centered once the keyboard has
 * settled. The surrounding scroll area pads by --kb-inset. */
export default function NotesField({ value, onChange, disabled, placeholder = "Notes (optional)" }: Props) {
  return (
    <div className="notes-field" data-no-swipe>
      <textarea
        className="log-notes"
        placeholder={placeholder}
        value={value}
        rows={3}
        disabled={disabled}
        autoCapitalize="sentences"
        enterKeyHint="done"
        onFocus={(e) => scrollIntoViewWhenSettled(e.currentTarget)}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="flag-hint">Details → @artemis</div>
    </div>
  );
}
