import { describe, expect, it, vi } from "vitest";
import { UPSTREAM, handleApiRequest, isAllowedApiHost } from "../shared/api-proxy";

const ENV = { HEALTH_API_KEY: "test-key" };

function upstreamOk() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  );
}

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

describe("handleApiRequest host guard", () => {
  it("production host: proxies upstream with the key attached", async () => {
    const fetchImpl = upstreamOk();
    const res = await handleApiRequest(
      new Request("https://gym.rdm.is/api/health/today?x=1", {
        headers: { cookie: "CF_Authorization=abc", "cf-access-jwt-assertion": "jwt" },
      }),
      ENV,
      { fetchImpl }
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [target, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(target).toBe(`${UPSTREAM}/health/today?x=1`);
    const headers = new Headers(init.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("cf-access-jwt-assertion")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("preview subdomain: proxies upstream", async () => {
    const fetchImpl = upstreamOk();
    const res = await handleApiRequest(
      new Request("https://4e0c638a.gym-display.pages.dev/api/health/status"),
      ENV,
      { fetchImpl }
    );
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    "https://gym-display.pages.dev/api/health/today",
    "https://evilgym-display.pages.dev/api/health/today",
    "https://gym.rdm.is.evil.example/api/health/today",
  ])("other host %s: 403 and upstream never called", async (url) => {
    const fetchImpl = upstreamOk();
    const res = await handleApiRequest(new Request(url), ENV, { fetchImpl });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden_host" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forbidden host: POST body is never forwarded", async () => {
    const fetchImpl = upstreamOk();
    const res = await handleApiRequest(
      new Request("https://gym-display.pages.dev/api/health/log", {
        method: "POST",
        body: JSON.stringify({ plan_id: 1 }),
      }),
      ENV,
      { fetchImpl }
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
