import { describe, expect, it } from "vitest";
import { composeSetNotes, formatSetup, parseSetup, QUICK_FLAGS, supportsSetting } from "../src/lib/set-notes";

describe("composeSetNotes", () => {
  it("returns null when there is nothing to record", () => {
    expect(composeSetNotes({})).toBeNull();
    expect(composeSetNotes({ flags: [], setup: null })).toBeNull();
    expect(composeSetNotes({ setup: {} })).toBeNull();
  });

  it("orders tokens: finisher, seat/pad/range, then flags in canonical order", () => {
    expect(
      composeSetNotes({ finisher: true, setup: { range: 2, seat: 7 }, flags: ["felt off", "machine taken"] }),
    ).toBe("finisher; seat=7; range=2; machine taken; felt off");
  });

  it("records a zero position", () => {
    expect(composeSetNotes({ setup: { pad: 0 } })).toBe("pad=0");
  });

  it("exposes the four quick flags", () => {
    expect(QUICK_FLAGS).toEqual(["skipped", "machine taken", "felt off", "form breakdown"]);
  });
});

describe("parseSetup", () => {
  it("round-trips the named positions", () => {
    expect(parseSetup(composeSetNotes({ finisher: true, setup: { seat: 4, pad: 3, range: 1 }, flags: ["skipped"] })))
      .toEqual({ seat: 4, pad: 3, range: 1 });
  });

  it("handles decimals and any order", () => {
    expect(parseSetup("machine taken; pad=3.5; seat=4")).toEqual({ seat: 4, pad: 3.5 });
  });

  it("reads a legacy setting=<n> as the seat, unless a seat is also given", () => {
    expect(parseSetup("setting=4")).toEqual({ seat: 4 });
    expect(parseSetup("setting=4; seat=6")).toEqual({ seat: 6 });
  });

  it("returns nothing for notes without positions", () => {
    expect(parseSetup(null)).toEqual({});
    expect(parseSetup("finisher")).toEqual({});
    expect(parseSetup("seat setting 4")).toEqual({});
  });

  it("formats for display", () => {
    expect(formatSetup({ seat: 4, range: 2 })).toBe("seat 4 · range 2");
    expect(formatSetup({})).toBe("");
  });
});

describe("supportsSetting", () => {
  it("machines, cables and the Smith have a setting; dumbbells and bodyweight don't", () => {
    expect(supportsSetting("machine")).toBe(true);
    expect(supportsSetting("cable")).toBe(true);
    expect(supportsSetting("smith")).toBe(true);
    expect(supportsSetting("dumbbell")).toBe(false);
    expect(supportsSetting("bodyweight")).toBe(false);
  });
});
