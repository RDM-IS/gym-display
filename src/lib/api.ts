import type { NoPlanResponse, Plan } from "./types";

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const API_KEY = import.meta.env.VITE_API_KEY ?? "";

const CACHE_PREFIX = "gym_plan_";

function todayKeyCT(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

export function cacheKeyForToday(): string {
  return `${CACHE_PREFIX}${todayKeyCT()}`;
}

export function readCachedPlan(): Plan | null {
  try {
    const raw = localStorage.getItem(cacheKeyForToday());
    if (!raw) return null;
    return JSON.parse(raw) as Plan;
  } catch {
    return null;
  }
}

export function writeCachedPlan(plan: Plan): void {
  try {
    localStorage.setItem(cacheKeyForToday(), JSON.stringify(plan));
  } catch {
    // localStorage may be full or unavailable — non-fatal
  }
}

export type FetchTodayResult =
  | { status: "ok"; plan: Plan; from_cache: boolean }
  | { status: "no_plan"; message: string }
  | { status: "error"; message: string };

export async function fetchTodayPlan(): Promise<FetchTodayResult> {
  const cached = readCachedPlan();
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const res = await fetch(`${API_BASE}/api/health/today`, { headers });
    if (res.status === 404) {
      const body = (await res.json().catch(() => null)) as NoPlanResponse | null;
      return {
        status: "no_plan",
        message: body?.fallback ?? "No plan for today.",
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const plan = (await res.json()) as Plan;
    writeCachedPlan(plan);
    return { status: "ok", plan, from_cache: false };
  } catch (err) {
    if (cached) {
      return { status: "ok", plan: cached, from_cache: true };
    }
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load plan.",
    };
  }
}
