// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { JwksCache } from "../shared/access-jwt";
import {
  UPSTREAM,
  configuredAudiences,
  handleApiRequest,
  isAllowedApiHost,
  type ApiProxyEnv,
} from "../shared/api-proxy";
import {
  CERTS_URL,
  NOW,
  NOW_SEC,
  TEAM_DOMAIN,
  claims,
  jwksResponse,
  makeSigner,
  type Signer,
} from "./helpers/access-fixtures";

const PROD_AUD = "aud-gym-rdm-is";
const PREVIEW_AUD = "aud-gym-display-preview";

const ENV: ApiProxyEnv = {
  HEALTH_API_KEY: "super-secret-lambda-key",
  ACCESS_AUD_PRODUCTION: PROD_AUD,
  ACCESS_AUD_PREVIEW: PREVIEW_AUD,
  ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
};

const PROD_ORIGIN = "https://gym.rdm.is";
const PREVIEW_ORIGIN = "https://4e0c638a.gym-display.pages.dev";

let signer: Signer;
let otherSigner: Signer;

beforeAll(async () => {
  signer = await makeSigner("kid-1");
  // Same kid, different private key: a forged token the JWKS can't vouch for.
  otherSigner = await makeSigner("kid-1");
});

interface UpstreamCall {
  url: string;
  method: string;
  headers: Headers;
}

/** Answers the certs endpoint; records anything aimed at the Lambda. */
function stubFetch(keys: JsonWebKey[]) {
  const upstream: UpstreamCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === CERTS_URL) return jwksResponse(keys);
    upstream.push({
      url,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers as HeadersInit),
    });
    return new Response(JSON.stringify({ plan_date: "2026-09-16" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, upstream };
}

function request(
  path: string,
  {
    token,
    cookie,
    method = "GET",
    origin = PROD_ORIGIN,
  }: { token?: string; cookie?: string; method?: string; origin?: string } = {}
): Request {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  if (cookie) headers.set("Cookie", cookie);
  return new Request(`${origin}${path}`, { method, headers });
}

function call(req: Request, env: ApiProxyEnv = ENV, keys: JsonWebKey[] = [signer.jwk]) {
  const stub = stubFetch(keys);
  return {
    stub,
    resp: handleApiRequest(req, env, { fetchImpl: stub.impl, now: NOW, cache: new JwksCache() }),
  };
}

async function expectAccessRequired(resp: Promise<Response>, upstream: UpstreamCall[]) {
  const res = await resp;
  expect(res.status).toBe(401);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(res.headers.get("location")).toBeNull();
  expect(await res.json()).toEqual({ error: "access_required" });
  expect(upstream).toHaveLength(0);
}

// ─── gate 1: host guard ──────────────────────────────────────────────────────

describe("isAllowedApiHost", () => {
  it.each([
    ["gym.rdm.is", true],
    ["GYM.RDM.IS", true],
    ["gym.rdm.is.", true],
    ["abc123.gym-display.pages.dev", true],
    ["fix-proxy-host-guard.gym-display.pages.dev", true],
    ["gym-display.pages.dev", false],
    [".gym-display.pages.dev", false],
    ["evilgym-display.pages.dev", false],
    ["gym.rdm.is.evil.example", false],
    ["rdm.is", false],
    ["localhost", false],
  ])("%s -> %s", (host, allowed) => {
    expect(isAllowedApiHost(host)).toBe(allowed);
  });
});

describe("handleApiRequest — host guard", () => {
  it.each([
    "https://gym-display.pages.dev",
    "https://evilgym-display.pages.dev",
    "https://gym.rdm.is.evil.example",
  ])("403s %s even with a valid token, and never reaches the Lambda", async (origin) => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(request("/api/health/today", { token, origin }));
    const res = await resp;
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_host" });
    expect(stub.upstream).toHaveLength(0);
  });

  it("403s a forbidden-host POST without forwarding its body", async () => {
    const { stub, resp } = call(
      request("/api/health/log", { method: "POST", origin: "https://gym-display.pages.dev" })
    );
    expect((await resp).status).toBe(403);
    expect(stub.upstream).toHaveLength(0);
  });
});

// ─── gate 2: Access JWT ──────────────────────────────────────────────────────

describe("handleApiRequest — valid token for each audience", () => {
  it("production app token on gym.rdm.is is proxied with the key", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(request("/api/health/today?days=7", { token }));
    const res = await resp;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan_date: "2026-09-16" });
    expect(stub.upstream).toHaveLength(1);
    expect(stub.upstream[0].url).toBe(`${UPSTREAM}/health/today?days=7`);
    expect(stub.upstream[0].headers.get("x-api-key")).toBe("super-secret-lambda-key");
  });

  it("preview app token on a preview alias is proxied with the key", async () => {
    const token = await signer.sign(claims({ aud: [PREVIEW_AUD] }));
    const { stub, resp } = call(
      request("/api/health/status", { token, origin: PREVIEW_ORIGIN })
    );
    expect((await resp).status).toBe(200);
    expect(stub.upstream).toHaveLength(1);
    expect(stub.upstream[0].headers.get("x-api-key")).toBe("super-secret-lambda-key");
  });

  it("accepts the CF_Authorization cookie when the header is absent", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(
      request("/api/health/today", { cookie: `CF_Authorization=${token}` })
    );
    expect((await resp).status).toBe(200);
    expect(stub.upstream).toHaveLength(1);
  });

  it("still honours the legacy single ACCESS_AUD variable", async () => {
    const token = await signer.sign(claims({ aud: ["legacy-aud"] }));
    const { stub, resp } = call(request("/api/health/today", { token }), {
      HEALTH_API_KEY: "k",
      ACCESS_AUD: "legacy-aud",
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    });
    expect((await resp).status).toBe(200);
    expect(stub.upstream).toHaveLength(1);
  });
});

describe("handleApiRequest — rejected tokens return 401 access_required", () => {
  it("wrong audience", async () => {
    const token = await signer.sign(claims({ aud: ["another-app"] }));
    const { stub, resp } = call(request("/api/health/today", { token }));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("expired token", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD], exp: NOW_SEC - 3600 }));
    const { stub, resp } = call(request("/api/health/today", { token }));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("missing token", async () => {
    const { stub, resp } = call(request("/api/health/today"));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("bad signature (right kid, wrong private key)", async () => {
    const forged = await otherSigner.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(request("/api/health/today", { token: forged }));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("tampered payload on an otherwise valid token", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const [h, , sig] = token.split(".");
    const evil = btoa(JSON.stringify(claims({ aud: [PROD_AUD], email: "attacker@example.com" })))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const { stub, resp } = call(request("/api/health/today", { token: `${h}.${evil}.${sig}` }));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("a POST to /log without a token never reaches health.session_log", async () => {
    const { stub, resp } = call(request("/api/health/log", { method: "POST" }));
    await expectAccessRequired(resp, stub.upstream);
  });

  it("fails closed when no audience is configured at all", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(request("/api/health/today", { token }), {
      HEALTH_API_KEY: "k",
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    });
    await expectAccessRequired(resp, stub.upstream);
  });

  it("never forwards HEALTH_API_KEY on any rejected request", async () => {
    const expired = await signer.sign(claims({ aud: [PROD_AUD], exp: NOW_SEC - 3600 }));
    for (const req of [
      request("/api/health/today"),
      request("/api/health/today", { token: expired }),
      request("/api/health/log", { method: "POST", token: "not-a-jwt" }),
    ]) {
      const { stub, resp } = call(req);
      await resp;
      expect(stub.upstream).toHaveLength(0);
    }
  });
});

describe("handleApiRequest — forwarding hygiene", () => {
  it("strips the caller's Access identity before calling upstream", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { stub, resp } = call(
      request("/api/health/today", { token, cookie: `CF_Authorization=${token}` })
    );
    await resp;
    expect(stub.upstream[0].headers.get("cookie")).toBeNull();
    expect(stub.upstream[0].headers.get("cf-access-jwt-assertion")).toBeNull();
  });

  it("marks proxied responses no-store", async () => {
    const token = await signer.sign(claims({ aud: [PROD_AUD] }));
    const { resp } = call(request("/api/health/today", { token }));
    expect((await resp).headers.get("cache-control")).toBe("no-store");
  });
});

describe("configuredAudiences", () => {
  it("trims, drops blanks and de-duplicates", () => {
    expect(
      configuredAudiences({
        HEALTH_API_KEY: "k",
        ACCESS_AUD_PRODUCTION: " a ",
        ACCESS_AUD_PREVIEW: "",
        ACCESS_AUD: "a",
      })
    ).toEqual(["a"]);
  });
});
