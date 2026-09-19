import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionBanner from "../src/components/SessionBanner";
import { fetchTodayPlan, postLog } from "../src/lib/api";
import {
  _resetQueueForTests,
  flushQueue,
  queueState,
  restoreQueue,
  submitLog,
} from "../src/lib/log-queue";
import {
  _resetSessionForTests,
  isSessionExpired,
  isSessionExpiredResponse,
  markSessionExpired,
} from "../src/lib/session";
import type { LogExerciseIn } from "../src/lib/types";

const STORAGE_KEY = "gym_log_queue";

function body(set_num: number): LogExerciseIn {
  return { plan_id: 103, exercise: "Leg press", log_type: "strength_set", sets: [{ set_num }] };
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ACCESS_REQUIRED = () => json(401, { error: "access_required" });

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  _resetSessionForTests();
  _resetQueueForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("isSessionExpiredResponse", () => {
  it("401 access_required is expired", async () => {
    expect(await isSessionExpiredResponse(ACCESS_REQUIRED())).toBe(true);
  });

  it("an HTML body (the Access login page) is expired", async () => {
    const html = new Response("<html>Sign in</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    expect(await isSessionExpiredResponse(html)).toBe(true);
  });

  it("an opaque redirect is expired", async () => {
    const opaque = { type: "opaqueredirect", redirected: false, url: "", status: 0,
      headers: new Headers() } as unknown as Response;
    expect(await isSessionExpiredResponse(opaque)).toBe(true);
  });

  it("a followed redirect onto cloudflareaccess.com is expired", async () => {
    const landed = { type: "basic", redirected: true, status: 200,
      url: "https://rdmis.cloudflareaccess.com/cdn-cgi/access/login/gym.rdm.is",
      headers: new Headers({ "content-type": "application/json" }) } as unknown as Response;
    expect(await isSessionExpiredResponse(landed)).toBe(true);
  });

  it("a Lambda 401 (bad key) is NOT a session problem", async () => {
    expect(await isSessionExpiredResponse(json(401, { detail: { error: "unauthorized" } }))).toBe(false);
  });

  it("normal JSON 200 and 404 are not expired", async () => {
    expect(await isSessionExpiredResponse(json(200, { plan_id: 1 }))).toBe(false);
    expect(await isSessionExpiredResponse(json(404, { error: "no_plan" }))).toBe(false);
  });
});

describe("api calls under an expired session", () => {
  it("every /api fetch opts into redirect: manual", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { plan_id: 1 }));
    await fetchTodayPlan();
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("a read flips the global flag and returns an error", async () => {
    fetchMock.mockResolvedValueOnce(ACCESS_REQUIRED());
    const r = await fetchTodayPlan();
    expect(r.status).toBe("error");
    expect(isSessionExpired()).toBe(true);
  });

  it("postLog reports sessionExpired and retryable", async () => {
    fetchMock.mockResolvedValueOnce(ACCESS_REQUIRED());
    const r = await postLog(body(1));
    expect(r).toMatchObject({ status: "error", retryable: true, sessionExpired: true });
  });

  it("a Lambda 401/403 is held for retry, not dropped", async () => {
    fetchMock.mockResolvedValueOnce(json(401, { detail: { error: "unauthorized" } }));
    expect(await postLog(body(1))).toMatchObject({ retryable: true });
    fetchMock.mockResolvedValueOnce(json(403, { detail: "Invalid API key" }));
    expect(await postLog(body(1))).toMatchObject({ retryable: true });
  });
});

describe("offline queue while the session is expired", () => {
  it("queues the set, persists it, and does not drop it", async () => {
    fetchMock.mockResolvedValue(ACCESS_REQUIRED());
    const r = await submitLog(body(1));
    expect(r.status).toBe("queued");
    expect(queueState()).toEqual({ pending: 1, failed: 0 });
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual([body(1)]);
  });

  it("holds later sets without sending them", async () => {
    fetchMock.mockResolvedValue(ACCESS_REQUIRED());
    await submitLog(body(1));
    const calls = fetchMock.mock.calls.length;
    expect((await submitLog(body(2))).status).toBe("queued");
    await flushQueue();
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toEqual([body(1), body(2)]);
  });

  it("survives a reload and replays once signed back in", async () => {
    fetchMock.mockResolvedValue(ACCESS_REQUIRED());
    await submitLog(body(1));
    await submitLog(body(2));

    // Simulated reload: module state gone, sessionStorage kept, session fresh.
    const persisted = sessionStorage.getItem(STORAGE_KEY);
    _resetQueueForTests();
    _resetSessionForTests();
    sessionStorage.setItem(STORAGE_KEY, persisted!);

    const posted: unknown[] = [];
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_url, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return json(200, { plan_id: 103, inserted: 1, rows: [] });
    });
    restoreQueue();
    await flushQueue();
    expect(posted).toEqual([body(1), body(2)]);
    expect(queueState()).toEqual({ pending: 0, failed: 0 });
  });
});

describe("SessionBanner", () => {
  it("is hidden until the session expires", () => {
    render(<SessionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => markSessionExpired());
    expect(screen.getByRole("alert").textContent).toBe("Session expired — tap to sign in");
  });

  it("tapping it does a full reload", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(<SessionBanner />);
      act(() => markSessionExpired());
      fireEvent.click(screen.getByRole("alert"));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
