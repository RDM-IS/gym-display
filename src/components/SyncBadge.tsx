import { useSyncExternalStore } from "react";
import { flushQueue, queueState, subscribeQueue, type QueueState } from "../lib/log-queue";

let cached: QueueState = queueState();
function snapshot(): QueueState {
  const s = queueState();
  if (s.pending !== cached.pending || s.failed !== cached.failed) cached = s;
  return cached;
}

/** Unsynced-log count. Hidden when everything has reached the server; tap to
 * retry now. */
export default function SyncBadge() {
  const s = useSyncExternalStore(subscribeQueue, snapshot, snapshot);
  if (s.pending === 0 && s.failed === 0) return null;
  return (
    <button
      type="button"
      className={`badge badge--button ${s.failed > 0 ? "badge--error" : "badge--warn"}`}
      onClick={() => void flushQueue()}
      aria-label={`${s.pending} unsynced sets${s.failed ? `, ${s.failed} failed` : ""} — tap to retry`}
    >
      {s.pending > 0 && `⟳ ${s.pending} unsynced`}
      {s.pending > 0 && s.failed > 0 && " · "}
      {s.failed > 0 && `${s.failed} failed`}
    </button>
  );
}
