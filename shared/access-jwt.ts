/**
 * Cloudflare Access JWT verification.
 *
 * Runs in the Workers runtime (Pages Functions) with nothing but WebCrypto —
 * no JWT library, no node builtins. Also runs under Node >= 18 for tests.
 *
 * Access puts the identity token on every request that passes through it, as
 * the `Cf-Access-Jwt-Assertion` header and as the `CF_Authorization` cookie.
 * Anything that reaches an origin *without* a valid one of those did not come
 * through Access and must not be served.
 */

export interface AccessPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  email?: string;
  type?: string;
  [claim: string]: unknown;
}

export type VerifyFailure =
  | "missing_token"
  | "malformed_token"
  | "unsupported_alg"
  | "unknown_key"
  | "bad_signature"
  | "bad_issuer"
  | "bad_audience"
  | "expired"
  | "not_yet_valid"
  | "jwks_unavailable";

export type VerifyResult =
  | { ok: true; payload: AccessPayload }
  | { ok: false; reason: VerifyFailure };

export interface VerifyOptions {
  /** e.g. "rdmis.cloudflareaccess.com" */
  teamDomain: string;
  /**
   * Accepted Access application AUD tag(s). A token passes when its `aud`
   * claim contains ANY of these (gym.rdm.is app, Pages preview app).
   */
  aud: string | string[];
  /** Epoch ms; injectable for tests. */
  now?: number;
  /** Tolerance for exp/nbf/iat, in seconds. */
  clockSkewSec?: number;
  fetchImpl?: typeof fetch;
  /** Defaults to the module-level cache (per isolate). */
  cache?: JwksCache;
}

const DEFAULT_CLOCK_SKEW_SEC = 60;
/** How long a fetched JWKS is reused before refetching. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** Floor between forced refetches when a kid misses (key rotation). */
const JWKS_MIN_REFETCH_MS = 60 * 1000;

export function certsUrl(teamDomain: string): string {
  return `https://${teamDomain}/cdn-cgi/access/certs`;
}

/** Both spellings Access has used for `iss` over time. */
function issuerMatches(iss: unknown, teamDomain: string): boolean {
  if (typeof iss !== "string") return false;
  const base = `https://${teamDomain}`;
  return iss === base || iss === `${base}/`;
}

function b64urlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlToJson(input: string): unknown {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(input)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the Access token off a request: header first (what Access injects),
 * cookie second (what the browser holds).
 */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header && header.trim()) return header.trim();

  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== "CF_Authorization") continue;
    const value = part.slice(eq + 1).trim();
    if (value) return value;
  }
  return null;
}

interface JwksEntry {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

/** Per-isolate JWKS cache. Signing keys rotate roughly every 6 weeks. */
export class JwksCache {
  private entries = new Map<string, JwksEntry>();
  private inflight = new Map<string, Promise<JwksEntry>>();

  clear(): void {
    this.entries.clear();
    this.inflight.clear();
  }

  async getKey(
    kid: string,
    url: string,
    now: number,
    fetchImpl: typeof fetch
  ): Promise<CryptoKey | null> {
    let entry = this.entries.get(url);

    if (!entry || now - entry.fetchedAt >= JWKS_TTL_MS) {
      entry = await this.refresh(url, now, fetchImpl);
    }

    const hit = entry.keys.get(kid);
    if (hit) return hit;

    // Unknown kid: the keys may have just rotated. Refetch, but not on every
    // request — an attacker with a bogus kid must not become a JWKS flood.
    if (now - entry.fetchedAt >= JWKS_MIN_REFETCH_MS) {
      entry = await this.refresh(url, now, fetchImpl);
      return entry.keys.get(kid) ?? null;
    }
    return null;
  }

  private async refresh(url: string, now: number, fetchImpl: typeof fetch): Promise<JwksEntry> {
    const pending = this.inflight.get(url);
    if (pending) return pending;

    const task = (async () => {
      const resp = await fetchImpl(url, { headers: { accept: "application/json" } });
      if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`);
      const body = (await resp.json()) as unknown;
      if (!isPlainObject(body) || !Array.isArray(body.keys)) {
        throw new Error("JWKS response has no keys");
      }

      const keys = new Map<string, CryptoKey>();
      for (const jwk of body.keys as JsonWebKey[]) {
        const kid = (jwk as { kid?: unknown }).kid;
        if (typeof kid !== "string" || jwk.kty !== "RSA") continue;
        if (jwk.alg && jwk.alg !== "RS256") continue;
        try {
          keys.set(
            kid,
            await crypto.subtle.importKey(
              "jwk",
              { ...jwk, alg: "RS256", ext: true, key_ops: ["verify"] },
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              false,
              ["verify"]
            )
          );
        } catch {
          // Skip a key we can't import; another one may still verify.
        }
      }

      const entry: JwksEntry = { keys, fetchedAt: now };
      this.entries.set(url, entry);
      return entry;
    })().finally(() => {
      this.inflight.delete(url);
    });

    this.inflight.set(url, task);
    return task;
  }
}

const defaultCache = new JwksCache();

/**
 * Verifies an Access JWT: signature first, then claims. Never throws —
 * every failure comes back as a reason code the caller turns into a 401.
 */
export async function verifyAccessJwt(
  token: string | null | undefined,
  options: VerifyOptions
): Promise<VerifyResult> {
  if (!token) return { ok: false, reason: "missing_token" };

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return { ok: false, reason: "malformed_token" };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  let header: unknown;
  let payload: unknown;
  try {
    header = b64urlToJson(encodedHeader);
    payload = b64urlToJson(encodedPayload);
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (!isPlainObject(header) || !isPlainObject(payload)) {
    return { ok: false, reason: "malformed_token" };
  }

  // Only RS256, and only with a kid. Blocks `alg: none` and HS256 key confusion.
  if (header.alg !== "RS256") return { ok: false, reason: "unsupported_alg" };
  if (typeof header.kid !== "string" || !header.kid) {
    return { ok: false, reason: "malformed_token" };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const cache = options.cache ?? defaultCache;
  const now = options.now ?? Date.now();

  let key: CryptoKey | null;
  try {
    key = await cache.getKey(header.kid, certsUrl(options.teamDomain), now, fetchImpl);
  } catch {
    return { ok: false, reason: "jwks_unavailable" };
  }
  if (!key) return { ok: false, reason: "unknown_key" };

  let signatureValid: boolean;
  try {
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
  } catch {
    return { ok: false, reason: "malformed_token" };
  }
  if (!signatureValid) return { ok: false, reason: "bad_signature" };

  const claims = payload as AccessPayload;

  if (!issuerMatches(claims.iss, options.teamDomain)) {
    return { ok: false, reason: "bad_issuer" };
  }

  const audience = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  const accepted = (Array.isArray(options.aud) ? options.aud : [options.aud]).filter(Boolean);
  if (accepted.length === 0 || !audience.some((a) => accepted.includes(a))) {
    return { ok: false, reason: "bad_audience" };
  }

  const skewSec = options.clockSkewSec ?? DEFAULT_CLOCK_SKEW_SEC;
  const nowSec = Math.floor(now / 1000);

  if (typeof claims.exp !== "number" || nowSec > claims.exp + skewSec) {
    return { ok: false, reason: "expired" };
  }
  if (typeof claims.nbf === "number" && nowSec + skewSec < claims.nbf) {
    return { ok: false, reason: "not_yet_valid" };
  }

  return { ok: true, payload: claims };
}

/**
 * 401 for any request that did not come through Access. JSON, never a
 * redirect: the caller is fetch(), which cannot complete an Access login —
 * the client turns this into a "Session expired — tap to sign in" banner.
 */
export function accessRequiredResponse(): Response {
  return new Response(JSON.stringify({ error: "access_required" }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
