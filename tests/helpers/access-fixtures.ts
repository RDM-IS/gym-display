/** Shared fixtures: RSA signers, Access-shaped claims, and a fake JWKS endpoint. */
import { certsUrl, type AccessPayload } from "../../shared/access-jwt";

export const TEAM_DOMAIN = "rdmis.cloudflareaccess.com";
export const AUD = "aud-tag-for-gym-display";
export const CERTS_URL = certsUrl(TEAM_DOMAIN);
export const NOW = Date.UTC(2026, 8, 15, 12, 0, 0); // 2026-09-15T12:00:00Z
export const NOW_SEC = Math.floor(NOW / 1000);

const RSA_PARAMS: RsaHashedKeyGenParams = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export function b64url(bytes: Uint8Array | string): string {
  const binary =
    typeof bytes === "string" ? bytes : Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface Signer {
  kid: string;
  jwk: JsonWebKey & { kid: string };
  sign: (payload: AccessPayload, header?: Record<string, unknown>) => Promise<string>;
}

export async function makeSigner(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(RSA_PARAMS, true, ["sign", "verify"]);
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk = { ...publicJwk, kid, alg: "RS256", use: "sig" } as JsonWebKey & { kid: string };

  return {
    kid,
    jwk,
    async sign(payload, headerOverrides = {}) {
      const header = { alg: "RS256", kid, typ: "JWT", ...headerOverrides };
      const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        pair.privateKey,
        new TextEncoder().encode(signingInput)
      );
      return `${signingInput}.${b64url(new Uint8Array(signature))}`;
    },
  };
}

/** A well-formed Access identity token payload. */
export function claims(overrides: AccessPayload = {}): AccessPayload {
  return {
    iss: `https://${TEAM_DOMAIN}`,
    aud: [AUD],
    sub: "user-1",
    email: "rjd.accts@gmail.com",
    type: "app",
    iat: NOW_SEC - 60,
    nbf: NOW_SEC - 60,
    exp: NOW_SEC + 3600,
    ...overrides,
  };
}

export interface FakeFetch {
  impl: typeof fetch;
  calls: number;
}

export function jwksResponse(keys: JsonWebKey[]): Response {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch that only ever answers the certs endpoint. */
export function jwksFetch(keys: JsonWebKey[]): FakeFetch {
  const state: FakeFetch = {
    calls: 0,
    impl: (async (input: RequestInfo | URL) => {
      state.calls += 1;
      if (String(input) !== CERTS_URL) throw new Error(`unexpected fetch: ${String(input)}`);
      return jwksResponse(keys);
    }) as unknown as typeof fetch,
  };
  return state;
}
