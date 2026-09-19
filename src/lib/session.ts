// ---------------------------------------------------------------------------
// Cloudflare Access session state.
//
// The /api proxy answers 401 {"error":"access_required"} when the Access
// session has lapsed. A fetch() can't complete an Access login, so the app
// shows a "Session expired — tap to sign in" banner and a full reload lets
// Access run its login flow. The offline log queue holds writes meanwhile.
//
// Detected as expired:
//   - 401 with JSON {"error":"access_required"}
//   - an opaque redirect (every /api fetch uses redirect:"manual", so an
//     Access 302 to cloudflareaccess.com surfaces here instead of as a
//     cross-origin CORS failure)
//   - a followed redirect that landed on cloudflareaccess.com
//   - an HTML body where JSON was expected (the Access login page)
// ---------------------------------------------------------------------------

let expired = false;
const listeners = new Set<() => void>();

export function isSessionExpired(): boolean {
  return expired;
}

export function markSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const l of listeners) l();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export class SessionExpiredError extends Error {
  constructor() {
    super("session_expired");
    this.name = "SessionExpiredError";
  }
}

export async function isSessionExpiredResponse(res: Response): Promise<boolean> {
  if (res.type === "opaqueredirect") return true;
  if (res.redirected && /cloudflareaccess\.com/i.test(res.url)) return true;

  const contentType = res.headers.get("content-type") ?? "";
  if (/text\/html/i.test(contentType)) return true;

  if (res.status === 401) {
    try {
      const body = (await res.clone().json()) as { error?: unknown };
      return body?.error === "access_required";
    } catch {
      return false;
    }
  }
  return false;
}

/** Full reload: Access sees no valid cookie and runs its login flow, then
 * returns to this origin with sessionStorage (and the log queue) intact. */
export function signInAgain(): void {
  window.location.reload();
}

export function _resetSessionForTests(): void {
  expired = false;
  listeners.clear();
}
