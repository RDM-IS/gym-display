import type {
  LastLoggedResponse,
  LogExerciseIn,
  LogResponse,
  LoggedTodayResponse,
  NoPlanResponse,
  Plan,
  SessionsResponse,
  StatusResponse,
} from "./types";

// Production always calls the same-origin /api proxy, which sits behind
// Cloudflare Access and attaches the key server-side. A direct upstream URL
// and key are honoured ONLY under `vite dev` (local, no proxy) — the DEV
// branch is statically false in a production build, so neither value can be
// inlined into the shipped bundle even if VITE_* vars are set in Pages.
const API_BASE = import.meta.env.DEV
  ? (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "")
  : "";
const API_KEY = import.meta.env.DEV ? import.meta.env.VITE_API_KEY ?? "" : "";

export type FetchTodayResult =
  | { status: "ok"; plan: Plan }
  | { status: "no_plan"; message: string }
  | { status: "error"; message: string };

export async function fetchTodayPlan(): Promise<FetchTodayResult> {
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
    return { status: "ok", plan };
  } catch (err) {
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
  /** retryable: network failure, 5xx, 408 or 429 — safe to queue and resend. */
  | { status: "error"; message: string; retryable: boolean };

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export async function postLog(body: LogExerciseIn): Promise<PostLogResult> {
  // A fetch that throws (offline, DNS, CORS abort) is retryable by default.
  let retryable = true;
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
      retryable = isRetryableStatus(res.status);
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
      retryable,
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
export type FetchSessionsResult =
  | { status: "ok"; data: SessionsResponse }
  | { status: "error"; message: string };

/** Per-day plan + per-set rows + computed aggregates for the Status page.
 * Default 7 days, server clamps to MAX 30. */
export async function fetchSessions(days = 7): Promise<FetchSessionsResult> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;
    const res = await fetch(`${API_BASE}/api/health/sessions?days=${days}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as SessionsResponse;
    return { status: "ok", data };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Failed to load sessions.",
    };
  }
}

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
