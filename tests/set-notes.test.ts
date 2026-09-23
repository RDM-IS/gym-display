import { describe, expect, it } from "vitest";
import { composeSetNotes, formatSetup, parseSetup, QUICK_FLAGS, supportsSetting, setupReminder } from "../src/lib/set-notes";

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

// ── GD-REST-TILES follow-up: the note keeps the reminder, not the prescription
describe("the setup reminder in an exercise note", () => {
  it("drops the prescription and keeps the reminder", () => {
    expect(setupReminder("2×10-12; log seat + pin setting")).toBe("log seat + pin setting");
  });

  it("is null when the note was only a prescription", () => {
    for (const n of ["3×10-12", "2×8-12", "2 × 12", "3x8-12"]) {
      expect(setupReminder(n), n).toBeNull();
    }
  });

  it("leaves a note that is not a prescription alone", () => {
    expect(setupReminder("10 each side")).toBe("10 each side");
    expect(setupReminder("keep the elbows tucked")).toBe("keep the elbows tucked");
  });

  it("handles the separators the plans actually use", () => {
    expect(setupReminder("2×10-12 · log seat")).toBe("log seat");
    expect(setupReminder("2×10-12, log seat")).toBe("log seat");
    expect(setupReminder("2x10-12 - log seat")).toBe("log seat");
  });

  it("is null for nothing at all", () => {
    expect(setupReminder(null)).toBeNull();
    expect(setupReminder(undefined)).toBeNull();
    expect(setupReminder("   ")).toBeNull();
  });
});
