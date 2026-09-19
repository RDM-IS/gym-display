// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import {
  JwksCache,
  extractAccessToken,
  accessRequiredResponse,
  verifyAccessJwt,
} from "../shared/access-jwt";
import {
  AUD,
  CERTS_URL,
  NOW,
  NOW_SEC,
  TEAM_DOMAIN,
  b64url,
  claims,
  jwksFetch,
  makeSigner,
  type FakeFetch,
  type Signer,
} from "./helpers/access-fixtures";

let signer: Signer;
let otherSigner: Signer;

beforeAll(async () => {
  [signer, otherSigner] = await Promise.all([makeSigner("kid-1"), makeSigner("kid-2")]);
});

function verify(
  token: string | null | undefined,
  opts: { fetcher?: FakeFetch; cache?: JwksCache; now?: number; aud?: string | string[] } = {}
) {
  const fetcher = opts.fetcher ?? jwksFetch([signer.jwk]);
  return verifyAccessJwt(token, {
    teamDomain: TEAM_DOMAIN,
    aud: opts.aud ?? AUD,
    now: opts.now ?? NOW,
    fetchImpl: fetcher.impl,
    cache: opts.cache ?? new JwksCache(),
  });
}

describe("verifyAccessJwt — valid", () => {
  it("accepts a correctly signed, in-date token for this aud", async () => {
    const result = await verify(await signer.sign(claims()));
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.payload.email).toBe("rjd.accts@gmail.com");
  });

  it("accepts aud as a bare string as well as an array", async () => {
    const result = await verify(await signer.sign(claims({ aud: AUD })));
    expect(result.ok).toBe(true);
  });

  it("accepts the issuer with or without a trailing slash", async () => {
    const result = await verify(await signer.sign(claims({ iss: `https://${TEAM_DOMAIN}/` })));
    expect(result.ok).toBe(true);
  });

  it("tolerates small clock skew on a just-expired token", async () => {
    const result = await verify(await signer.sign(claims({ exp: NOW_SEC - 30 })));
    expect(result.ok).toBe(true);
  });
});

describe("verifyAccessJwt — expired", () => {
  it("rejects a token whose exp is past, beyond the skew allowance", async () => {
    const result = await verify(await signer.sign(claims({ exp: NOW_SEC - 3600 })));
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token with no exp at all", async () => {
    const payload = claims();
    delete payload.exp;
    expect(await verify(await signer.sign(payload))).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token that is not yet valid", async () => {
    const result = await verify(await signer.sign(claims({ nbf: NOW_SEC + 3600 })));
    expect(result).toEqual({ ok: false, reason: "not_yet_valid" });
  });
});

describe("verifyAccessJwt — wrong audience", () => {
  it("rejects a token minted for another Access application", async () => {
    const result = await verify(await signer.sign(claims({ aud: ["some-other-app"] })));
    expect(result).toEqual({ ok: false, reason: "bad_audience" });
  });

  it("rejects a token with no aud claim", async () => {
    const payload = claims();
    delete payload.aud;
    expect(await verify(await signer.sign(payload))).toEqual({ ok: false, reason: "bad_audience" });
  });

  it("rejects everything when no audience is configured", async () => {
    expect(await verify(await signer.sign(claims()), { aud: "" })).toEqual({
      ok: false,
      reason: "bad_audience",
    });
    expect(await verify(await signer.sign(claims()), { aud: [] })).toEqual({
      ok: false,
      reason: "bad_audience",
    });
  });

  it("accepts a token for any one of several configured audiences", async () => {
    const token = await signer.sign(claims({ aud: ["preview-app-aud"] }));
    const result = await verify(token, { aud: ["prod-app-aud", "preview-app-aud"] });
    expect(result.ok).toBe(true);
  });

  it("rejects when none of several configured audiences match", async () => {
    const token = await signer.sign(claims({ aud: ["some-other-app"] }));
    const result = await verify(token, { aud: ["prod-app-aud", "preview-app-aud"] });
    expect(result).toEqual({ ok: false, reason: "bad_audience" });
  });

  it("rejects a token from a different team domain", async () => {
    const result = await verify(await signer.sign(claims({ iss: "https://evil.cloudflareaccess.com" })));
    expect(result).toEqual({ ok: false, reason: "bad_issuer" });
  });
});

describe("verifyAccessJwt — missing", () => {
  it("rejects null, undefined and empty tokens", async () => {
    expect(await verify(null)).toEqual({ ok: false, reason: "missing_token" });
    expect(await verify(undefined)).toEqual({ ok: false, reason: "missing_token" });
    expect(await verify("")).toEqual({ ok: false, reason: "missing_token" });
  });

  it("never fetches the JWKS when no token was presented", async () => {
    const fetcher = jwksFetch([signer.jwk]);
    await verify(null, { fetcher });
    expect(fetcher.calls).toBe(0);
  });
});

describe("verifyAccessJwt — forgery and malformed input", () => {
  it("rejects a token signed by a key that is not in the JWKS", async () => {
    const forged = await otherSigner.sign(claims());
    expect(await verify(forged)).toEqual({ ok: false, reason: "unknown_key" });
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const token = await signer.sign(claims());
    const [header, , signature] = token.split(".");
    const tampered = `${header}.${b64url(JSON.stringify(claims({ email: "attacker@example.com" })))}.${signature}`;
    expect(await verify(tampered)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a foreign key that reuses a trusted kid", async () => {
    const impostor = await makeSigner(signer.kid);
    expect(await verify(await impostor.sign(claims()))).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects alg:none and symmetric algs", async () => {
    const header = b64url(JSON.stringify({ alg: "none", kid: signer.kid, typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims()));
    expect(await verify(`${header}.${payload}.`)).toEqual({ ok: false, reason: "malformed_token" });
    expect(await verify(`${header}.${payload}.AAAA`)).toEqual({
      ok: false,
      reason: "unsupported_alg",
    });

    const hs256 = await signer.sign(claims(), { alg: "HS256" });
    expect(await verify(hs256)).toEqual({ ok: false, reason: "unsupported_alg" });
  });

  it("rejects a token with no kid", async () => {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify(claims()));
    expect(await verify(`${header}.${payload}.AAAA`)).toEqual({
      ok: false,
      reason: "malformed_token",
    });
  });

  it("rejects garbage that is not a JWT", async () => {
    expect(await verify("not-a-jwt")).toEqual({ ok: false, reason: "malformed_token" });
    expect(await verify("a.b.c")).toEqual({ ok: false, reason: "malformed_token" });
  });
});

describe("JWKS handling", () => {
  it("fetches the certs once and reuses them across requests", async () => {
    const fetcher = jwksFetch([signer.jwk]);
    const cache = new JwksCache();
    const token = await signer.sign(claims());

    expect((await verify(token, { fetcher, cache })).ok).toBe(true);
    expect((await verify(token, { fetcher, cache })).ok).toBe(true);
    expect(fetcher.calls).toBe(1);
  });

  it("does not re-fetch on every unknown kid", async () => {
    const fetcher = jwksFetch([signer.jwk]);
    const cache = new JwksCache();
    const forged = await otherSigner.sign(claims());

    for (let i = 0; i < 5; i++) {
      expect(await verify(forged, { fetcher, cache })).toEqual({ ok: false, reason: "unknown_key" });
    }
    expect(fetcher.calls).toBe(1);
  });

  it("re-fetches for an unknown kid once the refetch floor has passed (key rotation)", async () => {
    const cache = new JwksCache();
    const fetcher = jwksFetch([signer.jwk]);
    const rotated = await otherSigner.sign(claims());

    expect(await verify(rotated, { fetcher, cache })).toEqual({ ok: false, reason: "unknown_key" });

    const afterRotation = jwksFetch([signer.jwk, otherSigner.jwk]);
    const later = NOW + 5 * 60 * 1000;
    const result = await verifyAccessJwt(await otherSigner.sign(claims({ exp: NOW_SEC + 3600 })), {
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
      now: later,
      fetchImpl: afterRotation.impl,
      cache,
    });
    expect(result.ok).toBe(true);
    expect(afterRotation.calls).toBe(1);
  });

  it("fails closed when the certs endpoint is unavailable", async () => {
    const failing: FakeFetch = {
      calls: 0,
      impl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    };
    const result = await verify(await signer.sign(claims()), { fetcher: failing });
    expect(result).toEqual({ ok: false, reason: "jwks_unavailable" });
  });

  it("builds the certs URL from the team domain", () => {
    expect(CERTS_URL).toBe("https://rdmis.cloudflareaccess.com/cdn-cgi/access/certs");
  });
});

describe("extractAccessToken", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://gym.rdm.is/api/health/today", { headers });

  it("prefers the Cf-Access-Jwt-Assertion header", () => {
    expect(
      extractAccessToken(
        req({ "Cf-Access-Jwt-Assertion": "header-token", cookie: "CF_Authorization=cookie-token" })
      )
    ).toBe("header-token");
  });

  it("falls back to the CF_Authorization cookie", () => {
    expect(
      extractAccessToken(req({ cookie: "other=1; CF_Authorization=cookie-token; more=2" }))
    ).toBe("cookie-token");
  });

  it("returns null with no header and no cookie", () => {
    expect(extractAccessToken(req({}))).toBeNull();
    expect(extractAccessToken(req({ cookie: "other=1" }))).toBeNull();
    expect(extractAccessToken(req({ cookie: "CF_Authorization=" }))).toBeNull();
    expect(extractAccessToken(req({ "Cf-Access-Jwt-Assertion": "   " }))).toBeNull();
  });

  it("does not match a lookalike cookie name", () => {
    expect(extractAccessToken(req({ cookie: "NOT_CF_Authorization=x" }))).toBeNull();
  });
});

describe("accessRequiredResponse", () => {
  it("is a 401 JSON body with no cached copy", async () => {
    const resp = accessRequiredResponse();
    expect(resp.status).toBe(401);
    expect(resp.headers.get("content-type")).toBe("application/json");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(await resp.json()).toEqual({ error: "access_required" });
    expect(resp.headers.get("location")).toBeNull();
  });
});
