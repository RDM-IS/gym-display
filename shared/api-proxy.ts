/**
 * The /api/* proxy, as a plain Request -> Response function so it can be
 * exercised outside the Workers runtime. The Pages Function is a thin wrapper.
 *
 * Host guard: the proxy attaches HEALTH_API_KEY, so it must only answer on
 * hostnames that sit behind Cloudflare Access:
 *   - gym.rdm.is                      (production Access app)
 *   - *.gym-display.pages.dev         (preview + branch aliases, preview Access app)
 * Everything else — including the bare gym-display.pages.dev production alias,
 * which is NOT behind Access — gets 403 before the key is ever touched.
 */

export interface ApiProxyEnv {
  /** Lambda API key. Only ever attached to a request that passed the host guard. */
  HEALTH_API_KEY: string;
}

export interface ApiProxyDeps {
  fetchImpl?: typeof fetch;
}

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

export async function handleApiRequest(
  request: Request,
  env: ApiProxyEnv,
  deps: ApiProxyDeps = {}
): Promise<Response> {
  const url = new URL(request.url);
  if (!isAllowedApiHost(url.hostname)) return forbiddenHostResponse();

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
