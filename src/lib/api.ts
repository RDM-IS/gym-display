import type {
  LastLoggedResponse,
  LogExerciseIn,
  LogResponse,
  LoggedTodayResponse,
  NoPlanResponse,
  Plan,
  StatusResponse,
} from "./types";

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

export type FetchStatusResult =
  | { status: "ok"; data: StatusResponse }
  | { status: "error"; message: string };

export async function fetchStatus(): Promise<FetchStatusResult> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const res = await fetch(`${API_BASE}/api/health/status`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as StatusResponse;
    return { status: "ok", data };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load status.",
    };
  }
}

// ---------------------------------------------------------------------------
// Logging — POST /log + GET /today/logged
// ---------------------------------------------------------------------------
// Same-origin requests (gym.rdm.is/api/...) carry Cloudflare Access cookies
// automatically. No `credentials: "include"` needed; no cookie clearing in
// this client.

export type PostLogResult =
  | { status: "ok"; data: LogResponse }
  | { status: "error"; message: string };

export async function postLog(body: LogExerciseIn): Promise<PostLogResult> {
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const res = await fetch(`${API_BASE}/api/health/log`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        const detail = (j as { detail?: unknown }).detail;
        if (detail && typeof detail === "object") {
          msg = JSON.stringify(detail);
        } else if (typeof detail === "string") {
          msg = detail;
        }
      } catch {
        /* keep HTTP status */
      }
      throw new Error(msg);
    }
    const data = (await res.json()) as LogResponse;
    return { status: "ok", data };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to log.",
    };
  }
}

export type FetchLoggedResult =
  | { status: "ok"; data: LoggedTodayResponse }
  | { status: "error"; message: string };

export async function fetchLoggedToday(): Promise<FetchLoggedResult> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const res = await fetch(`${API_BASE}/api/health/today/logged`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as LoggedTodayResponse;
    return { status: "ok", data };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load logged state.",
    };
  }
}

export type FetchLastLoggedResult =
  | { status: "ok"; data: LastLoggedResponse }
  | { status: "error"; message: string };

/** Batch lookup of most-recent prior set per exercise. Used to pre-fill
 * stepper defaults so the common case needs zero edits. Empty list →
 * skips the network call and returns an empty map. */
export async function fetchLastLogged(exerciseNames: string[]): Promise<FetchLastLoggedResult> {
  const clean = exerciseNames.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) {
    return { status: "ok", data: { by_exercise: {} } };
  }
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const qs = encodeURIComponent(clean.join(","));
    const res = await fetch(`${API_BASE}/api/health/last_logged?exercises=${qs}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as LastLoggedResponse;
    return { status: "ok", data };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load last-logged.",
    };
  }
}
