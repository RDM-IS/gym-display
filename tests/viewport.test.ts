import { afterEach, describe, expect, it, vi } from "vitest";
import { computeViewportVars, installViewportVars, scrollIntoViewWhenSettled } from "../src/lib/viewport";

class FakeVisualViewport extends EventTarget {
  height: number;
  constructor(h: number) {
    super();
    this.height = h;
  }
}

function fakeWindow(innerHeight: number, vv: FakeVisualViewport | null): Window {
  const target = new EventTarget();
  return Object.assign(target, {
    innerHeight,
    visualViewport: vv,
    document,
    setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  }) as unknown as Window;
}

afterEach(() => {
  document.documentElement.style.removeProperty("--vvh");
  document.documentElement.style.removeProperty("--kb-inset");
  vi.useRealTimers();
});

describe("computeViewportVars", () => {
  it("keyboard closed → no inset", () => {
    expect(computeViewportVars(fakeWindow(834, new FakeVisualViewport(834)))).toEqual({ vvh: 834, kbInset: 0 });
  });

  it("keyboard open → inset = innerHeight − visualViewport.height", () => {
    expect(computeViewportVars(fakeWindow(834, new FakeVisualViewport(436)))).toEqual({ vvh: 436, kbInset: 398 });
  });

  it("no visualViewport → innerHeight and zero inset", () => {
    expect(computeViewportVars(fakeWindow(1194, null))).toEqual({ vvh: 1194, kbInset: 0 });
  });
});

describe("installViewportVars", () => {
  it("writes --vvh / --kb-inset and updates on visualViewport resize", () => {
    const vv = new FakeVisualViewport(834);
    const win = fakeWindow(834, vv);
    const cleanup = installViewportVars(win);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--vvh")).toBe("834px");
    expect(root.getPropertyValue("--kb-inset")).toBe("0px");

    vv.height = 500;
    vv.dispatchEvent(new Event("resize"));
    expect(root.getPropertyValue("--vvh")).toBe("500px");
    expect(root.getPropertyValue("--kb-inset")).toBe("334px");

    cleanup();
    vv.height = 834;
    vv.dispatchEvent(new Event("resize"));
    expect(root.getPropertyValue("--kb-inset")).toBe("334px");
  });
});

describe("scrollIntoViewWhenSettled", () => {
  it("centers once, on the first visualViewport resize", () => {
    vi.useFakeTimers();
    const vv = new FakeVisualViewport(834);
    const el = document.createElement("textarea");
    el.scrollIntoView = vi.fn();
    scrollIntoViewWhenSettled(el, fakeWindow(834, vv));
    vv.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(400);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
  });

  it("falls back to ~300 ms when the viewport never resizes", () => {
    vi.useFakeTimers();
    const el = document.createElement("textarea");
    el.scrollIntoView = vi.fn();
    scrollIntoViewWhenSettled(el, fakeWindow(834, new FakeVisualViewport(834)));
    vi.advanceTimersByTime(299);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(el.scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
