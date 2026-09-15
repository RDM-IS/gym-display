import { describe, expect, it } from "vitest";
import { composeSetNotes, parseSetting, QUICK_FLAGS, supportsSetting } from "../src/lib/set-notes";

describe("composeSetNotes", () => {
  it("returns null when there is nothing to record", () => {
    expect(composeSetNotes({})).toBeNull();
    expect(composeSetNotes({ flags: [], setting: null })).toBeNull();
  });

  it("orders tokens: finisher, setting, then flags in canonical order", () => {
    expect(
      composeSetNotes({ finisher: true, setting: 7, flags: ["felt off", "machine taken"] }),
    ).toBe("finisher; setting=7; machine taken; felt off");
  });

  it("records a zero setting", () => {
    expect(composeSetNotes({ setting: 0 })).toBe("setting=0");
  });

  it("exposes the four quick flags", () => {
    expect(QUICK_FLAGS).toEqual(["skipped", "machine taken", "felt off", "form breakdown"]);
  });
});

describe("parseSetting", () => {
  it("round-trips a composed note", () => {
    expect(parseSetting(composeSetNotes({ finisher: true, setting: 12, flags: ["skipped"] }))).toBe(12);
  });

  it("handles a bare setting and decimals", () => {
    expect(parseSetting("setting=4")).toBe(4);
    expect(parseSetting("machine taken; setting=3.5")).toBe(3.5);
  });

  it("returns null for missing / unrelated notes", () => {
    expect(parseSetting(null)).toBeNull();
    expect(parseSetting("finisher")).toBeNull();
    expect(parseSetting("seat setting 4")).toBeNull();
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
