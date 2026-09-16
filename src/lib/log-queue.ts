import { postLog } from "./api";
import { isSessionExpired } from "./session";
import type { LogExerciseIn, LogResponse } from "./types";

// ---------------------------------------------------------------------------
// Offline resilience for POST /api/health/log.
//
// A write that fails for a retryable reason (network, 5xx, 408/429, 401/403) is queued
// in memory and retried FIFO with exponential backoff, so set order is kept.
// While anything is queued, new writes join the back of the queue. The queue is
// mirrored to sessionStorage (guarded) so it survives a reload of this tab.
// Plan data is never stored here — the API stays the source of truth.
//
// While the Access session is expired nothing is sent: writes are held (and
// persisted) until the banner-triggered reload signs Ryan back in, after which
// restoreQueue() replays them.
// ---------------------------------------------------------------------------

export type SubmitResult =
  | { status: "ok"; data: LogResponse }
  | { status: "queued" }
  | { status: "error"; message: string };

export interface QueueState {
  pending: number;
  /** Writes the server rejected on retry (non-retryable). Not re-sent. */
  failed: number;
}

interface QueuedLog {
  body: LogExerciseIn;
  attempts: number;
}

const STORAGE_KEY = "gym_log_queue";
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

let queue: QueuedLog[] = [];
let failed = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const listeners = new Set<(s: QueueState) => void>();

function persist(): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(queue.map((q) => q.body)));
  } catch {
    /* storage unavailable — in-memory queue still works */
  }
}

function notify(): void {
  const s = queueState();
  for (const l of listeners) l(s);
}

function schedule(delayMs: number): void {
  if (timer !== null || queue.length === 0) return;
  timer = setTimeout(() => {
    timer = null;
    void flushQueue();
  }, delayMs);
}

function enqueue(body: LogExerciseIn): void {
  queue.push({ body, attempts: 0 });
  persist();
  notify();
  schedule(BASE_DELAY_MS);
}

export function queueState(): QueueState {
  return { pending: queue.length, failed };
}

export function subscribeQueue(listener: (s: QueueState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Reload any writes a previous load of this tab left unsynced. */
export function restoreQueue(): void {
  if (queue.length > 0) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const bodies = JSON.parse(raw) as LogExerciseIn[];
    if (!Array.isArray(bodies) || bodies.length === 0) return;
    queue = bodies.map((body) => ({ body, attempts: 0 }));
    notify();
    schedule(0);
  } catch {
    /* ignore corrupt / unavailable storage */
  }
}

/** Send queued writes in order until one fails retryably (then back off). */
export async function flushQueue(): Promise<void> {
  if (flushing || isSessionExpired()) return;
  flushing = true;
  try {
    while (queue.length > 0) {
      const head = queue[0];
      const r = await postLog(head.body);
      if (r.status === "ok") {
        queue.shift();
      } else if (r.sessionExpired) {
        // Hold everything; the reload after sign-in replays the queue.
        persist();
        notify();
        return;
      } else if (!r.retryable) {
        queue.shift();
        failed += 1;
        console.error("gym-display: queued log rejected", r.message, head.body);
      } else {
        head.attempts += 1;
        persist();
        notify();
        schedule(Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (head.attempts - 1)));
        return;
      }
      persist();
      notify();
    }
  } finally {
    flushing = false;
  }
}

/** Write one log body. Resolves "ok" when the server accepted it, "queued"
 * when it will be retried in the background, "error" when rejected outright. */
export async function submitLog(
  body: LogExerciseIn,
  opts: { keepalive?: boolean } = {},
): Promise<SubmitResult> {
  if (queue.length > 0 || isSessionExpired()) {
    enqueue(body);
    void flushQueue();
    return { status: "queued" };
  }
  const r = await postLog(body, opts);
  if (r.status === "ok") return r;
  if (r.retryable) {
    enqueue(body);
    return { status: "queued" };
  }
  return { status: "error", message: r.message };
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => void flushQueue());
}

export function _resetQueueForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  queue = [];
  failed = 0;
  flushing = false;
  listeners.clear();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
