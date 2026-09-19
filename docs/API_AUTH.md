# /api/* authentication

The Pages Function at `functions/api/[[path]].ts` proxies `/api/*` to the
`rdmis-crm-api` Lambda and attaches the server-side `X-API-Key`. The app always
calls this same-origin path in production builds; it never holds the key
itself (see `src/lib/api.ts`).

Two independent gates run before the key is attached. Both live in
`shared/api-proxy.ts`.

## Gate 1 — host guard (403)

Only hostnames that sit behind Cloudflare Access are proxied:

| Host | Behind |
| --- | --- |
| `gym.rdm.is` | the production Access application |
| `*.gym-display.pages.dev` | the Pages preview Access application |

Every other host gets `403 {"error":"forbidden_host"}` — including the bare
`gym-display.pages.dev` production alias, which is **not** behind Access. The
guard is defense in depth: it holds even if an Access policy is loosened.

## Gate 2 — Access JWT (401)

`shared/access-jwt.ts` (WebCrypto only, no dependencies):

1. Reads the token from the `Cf-Access-Jwt-Assertion` header, falling back to
   the `CF_Authorization` cookie.
2. Requires `alg: RS256` and a `kid` — `alg: none` and HS256 are rejected before
   any key lookup.
3. Verifies the signature against
   `https://<team-domain>/cdn-cgi/access/certs`, with the JWKS cached per
   isolate (1h TTL, plus a rate-limited refetch when a `kid` misses, so key
   rotation recovers without a deploy).
4. Checks `iss` (the team domain), `aud` (must contain **any** configured
   audience), and `exp`/`nbf` with 60s of clock skew.

Anything else returns `401 {"error":"access_required"}` — JSON, never a
redirect. The caller is `fetch()`, which cannot complete an Access login; the
app turns this response into a "Session expired — tap to sign in" banner.

It fails closed: if no audience is configured, or the certs endpoint is
unreachable, requests are rejected rather than proxied.

## Environment variables

Set on the Pages project in **both** Production and Preview (the proxy picks
whichever audience the token carries, so the same pair works everywhere):

| Variable | Required | Value |
| --- | --- | --- |
| `HEALTH_API_KEY` | yes | Lambda API key (secret). |
| `ACCESS_AUD_PRODUCTION` | yes* | AUD tag of the `gym.rdm.is` Access application. |
| `ACCESS_AUD_PREVIEW` | yes* | AUD tag of the Pages preview Access application. |
| `ACCESS_AUD` | no | Legacy single-audience variable; still honoured. |
| `ACCESS_TEAM_DOMAIN` | no | Defaults to `rdmis.cloudflareaccess.com`. |

\* At least one audience must be set or every request is rejected. **Set these
before deploying this change** — otherwise production `/api` starts returning
401 and the display cannot load a plan.

The AUD tag is on each Access application: Zero Trust → Access → Applications →
the app → Overview → **Application Audience (AUD) Tag**. AUD tags are not
secret.

`VITE_API_KEY` and `VITE_API_BASE_URL` are no longer read by production builds
and should be deleted from both environments.

Dashboard changes are operator-owned; this repo does not make them.
