/**
 * The /api/* proxy, as a plain Request -> Response function so it can be
 * exercised outside the Workers runtime. The Pages Function is a thin wrapper.
 *
 * Two independent gates run before HEALTH_API_KEY is ever attached:
 *
 * 1. Host guard (defense in depth). Only hostnames that sit behind Cloudflare
 *    Access are proxied:
 *      - gym.rdm.is                   (production Access app)
 *      - *.gym-display.pages.dev      (preview + branch aliases, preview Access app)
 *    Everything else — including the bare gym-display.pages.dev alias, which is
 *    NOT behind Access — gets 403.
 *
 * 2. Access JWT. The Cf-Access-Jwt-Assertion header (or CF_Authorization
 *    cookie) must verify against the team JWKS with an audience that matches
 *    one of the configured Access applications. Failure is 401 JSON
 *    {"error":"access_required"} — never a redirect, because the caller is a
 *    fetch() that cannot follow an Access login.
 */
import {
  JwksCache,
  accessRequiredResponse,
  extractAccessToken,
  verifyAccessJwt,
} from "./access-jwt";

export interface ApiProxyEnv {
  /** Lambda API key. Only ever attached to a request that passed both gates. */
  HEALTH_API_KEY: string;
  /** AUD tag of the gym.rdm.is Access application. */
  ACCESS_AUD_PRODUCTION?: string;
  /** AUD tag of the Pages preview (*.gym-display.pages.dev) Access application. */
  ACCESS_AUD_PREVIEW?: string;
  /** Legacy single-AUD variable from the first cut of this change; still honoured. */
  ACCESS_AUD?: string;
  /** Optional override; defaults to the rdmis team domain. */
  ACCESS_TEAM_DOMAIN?: string;
}

export interface ApiProxyDeps {
  fetchImpl?: typeof fetch;
  now?: number;
  cache?: JwksCache;
}

export const DEFAULT_TEAM_DOMAIN = "rdmis.cloudflareaccess.com";
export const UPSTREAM =
  "https://inolj7bn99.execute-api.us-east-1.amazonaws.com/default/rdmis-crm-api/api";

const PRODUCTION_HOST = "gym.rdm.is";
const PREVIEW_SUFFIX = ".gym-display.pages.dev";

export function isAllowedApiHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === PRODUCTION_HOST) return true;
  // endsWith on the dotted suffix: "x.gym-display.pages.dev" passes, the bare
  // "gym-display.pages.dev" and look-alikes such as "evilgym-display.pages.dev"
  // do not. A non-empty label must precede the suffix.
  return host.endsWith(PREVIEW_SUFFIX) && host.length > PREVIEW_SUFFIX.length;
}

export function forbiddenHostResponse(): Response {
  return new Response(JSON.stringify({ error: "forbidden_host" }), {
    status: 403,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/** Every configured Access audience, trimmed and de-duplicated. */
export function configuredAudiences(env: ApiProxyEnv): string[] {
  const all = [env.ACCESS_AUD_PRODUCTION, env.ACCESS_AUD_PREVIEW, env.ACCESS_AUD]
    .map((a) => (a ?? "").trim())
    .filter(Boolean);
  return [...new Set(all)];
}

export async function handleApiRequest(
  request: Request,
  env: ApiProxyEnv,
  deps: ApiProxyDeps = {}
): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedApiHost(url.hostname)) return forbiddenHostResponse();

  // Fail closed: an environment with no AUD configured can authenticate
  // nobody, so it proxies nothing.
  const audiences = configuredAudiences(env);
  if (audiences.length === 0) return accessRequiredResponse();

  const verdict = await verifyAccessJwt(extractAccessToken(request), {
    teamDomain: env.ACCESS_TEAM_DOMAIN || DEFAULT_TEAM_DOMAIN,
    aud: audiences,
    now: deps.now,
    fetchImpl: deps.fetchImpl,
    cache: deps.cache,
  });
  if (!verdict.ok) return accessRequiredResponse();

  const path = url.pathname.replace(/^\/api/, "");
  const target = UPSTREAM + path + url.search;

  const headers = new Headers(request.headers);
  headers.set("X-API-Key", env.HEALTH_API_KEY);
  headers.delete("host");
  // The caller's Access identity stays at the edge; upstream has no use for it.
  headers.delete("cookie");
  headers.delete("cf-access-jwt-assertion");

  const upstreamFetch = deps.fetchImpl ?? fetch;
  const resp = await upstreamFetch(target, {
    method: request.method,
    headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
  });

  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") || "application/json",
      "cache-control": "no-store",
    },
  });
}
