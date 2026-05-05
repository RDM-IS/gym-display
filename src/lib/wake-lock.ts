type WakeLockSentinelLike = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: "release", cb: () => void) => void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
};

let sentinel: WakeLockSentinelLike | null = null;

export async function acquireWakeLock(): Promise<boolean> {
  const nav = navigator as WakeLockNavigator;
  if (!nav.wakeLock) return false;
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
