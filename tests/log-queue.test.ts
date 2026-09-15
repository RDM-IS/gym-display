import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api", () => ({ postLog: vi.fn() }));

import { postLog } from "../src/lib/api";
import {
  _resetQueueForTests,
  flushQueue,
  queueState,
  restoreQueue,
  submitLog,
  subscribeQueue,
} from "../src/lib/log-queue";
import type { LogExerciseIn, LogResponse } from "../src/lib/types";

const mockPost = vi.mocked(postLog);

function body(set_num: number): LogExerciseIn {
  return { plan_id: 1, exercise: "Leg press", log_type: "strength_set", sets: [{ set_num }] };
}

const OK = { status: "ok" as const, data: { plan_id: 1, inserted: 1, rows: [] } as LogResponse };
const OFFLINE = { status: "error" as const, message: "Failed to fetch", retryable: true };
const REJECTED = { status: "error" as const, message: "HTTP 400", retryable: false };

beforeEach(() => {
  _resetQueueForTests();
  mockPost.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitLog", () => {
  it("passes a successful write straight through", async () => {
    mockPost.mockResolvedValueOnce(OK);
    expect((await submitLog(body(1))).status).toBe("ok");
    expect(queueState()).toEqual({ pending: 0, failed: 0 });
  });

  it("returns an error (not queued) when the server rejects the write", async () => {
    mockPost.mockResolvedValueOnce(REJECTED);
    const r = await submitLog(body(1));
    expect(r).toEqual({ status: "error", message: "HTTP 400" });
    expect(queueState().pending).toBe(0);
  });

  it("queues a retryable failure, retries with backoff, and clears on success", async () => {
    const seen: number[] = [];
    subscribeQueue((s) => seen.push(s.pending));
    mockPost.mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(OK);

    expect((await submitLog(body(1))).status).toBe("queued");
    expect(queueState().pending).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);   // first retry fails → backoff 2s
    expect(mockPost).toHaveBeenCalledTimes(2);
    expect(queueState().pending).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);   // second retry succeeds
    expect(mockPost).toHaveBeenCalledTimes(3);
    expect(queueState().pending).toBe(0);
    expect(seen.at(-1)).toBe(0);
  });

  it("keeps set order: writes made while queued join the back of the queue", async () => {
    mockPost.mockResolvedValueOnce(OFFLINE);
    await submitLog(body(1));
    mockPost.mockResolvedValue(OK);
    expect((await submitLog(body(2))).status).toBe("queued");
    await flushQueue();
    const sent = mockPost.mock.calls.map((c) => c[0].sets[0].set_num);
    expect(sent).toEqual([1, 1, 2]);
    expect(queueState().pending).toBe(0);
  });

  it("counts a write the server rejects on retry as failed and moves on", async () => {
    mockPost.mockResolvedValueOnce(OFFLINE).mockResolvedValueOnce(REJECTED);
    await submitLog(body(1));
    await flushQueue();
    expect(queueState()).toEqual({ pending: 0, failed: 1 });
  });

  it("mirrors the queue to sessionStorage and restores it after a reload", async () => {
    mockPost.mockResolvedValueOnce(OFFLINE);
    await submitLog(body(3));
    const saved = sessionStorage.getItem("gym_log_queue");
    expect(saved).toContain('"set_num":3');

    // Simulate a fresh page load: in-memory queue gone, storage kept.
    _resetQueueForTests();
    sessionStorage.setItem("gym_log_queue", saved!);
    mockPost.mockResolvedValue(OK);
    restoreQueue();
    expect(queueState().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(queueState().pending).toBe(0);
  });
});
