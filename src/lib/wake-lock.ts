type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

let sentinel: WakeLockSentinelLike | null = null;

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as WakeLockNavigator).wakeLock;
}

export async function acquireWakeLock(): Promise<boolean> {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return false;
  if (sentinel && !sentinel.released) return true;
  try {
    sentinel = await nav.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
    return true;
  } catch {
    sentinel = null;
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (!sentinel) return;
  try {
    await sentinel.release();
  } catch {
    // ignore
  }
  sentinel = null;
}

export function isWakeLockHeld(): boolean {
  return sentinel !== null && !sentinel.released;
}

const WAKE_HINT_KEY = "gym_wake_hint_shown";

/** True exactly once per device when the wake lock couldn't be held, so the
 * workout screen can show the "set Auto-Lock to Never" hint. */
export function takeWakeHint(acquired: boolean): boolean {
  if (acquired) return false;
  try {
    if (localStorage.getItem(WAKE_HINT_KEY)) return false;
    localStorage.setItem(WAKE_HINT_KEY, "1");
  } catch {
    /* storage blocked — show the hint this time */
  }
  return true;
}
