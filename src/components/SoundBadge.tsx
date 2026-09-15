import { useSyncExternalStore } from "react";
import { audioStatus, subscribeAudio, toggleMuted, unlockAudio } from "../lib/audio";

/** Visible sound state. iOS only starts audio from a tap, so "locked" is a
 * button that unlocks it. */
export default function SoundBadge() {
  const status = useSyncExternalStore(subscribeAudio, audioStatus, audioStatus);
  if (status === "unsupported") return null;
  if (status === "locked") {
    return (
      <button type="button" className="badge badge--button badge--warn" onClick={() => void unlockAudio()}>
        🔈 Tap for sound
      </button>
    );
  }
  return (
    <button
      type="button"
      className="badge badge--button"
      onClick={() => toggleMuted()}
      aria-label={status === "on" ? "Sound on — tap to mute" : "Muted — tap for sound"}
    >
      {status === "on" ? "🔊 Sound on" : "🔇 Muted"}
    </button>
  );
}
