import { describe, it, expect } from "vitest";
import { zoneText, workZoneText, easyZoneText, extraLabel } from "./zones";

const Z2 = { zone: "Z2", low_bpm: 105, high_bpm: 122, source: "estimate" };

describe("zoneText", () => {
  it("reads as the zone and its range", () => {
    expect(zoneText(Z2)).toBe("Z2 105–122 bpm");
  });

  it("is null rather than a range made of undefined", () => {
    expect(zoneText(null)).toBeNull();
    expect(zoneText(undefined)).toBeNull();
    // A row that carries the key but not the numbers shows nothing, not "NaN".
    expect(zoneText({ zone: "Z4" } as never)).toBeNull();
  });

  it("still renders a range with no zone name", () => {
    expect(zoneText({ low_bpm: 130, high_bpm: 150 } as never)).toBe("130–150 bpm");
  });
});

describe("work and easy", () => {
  it("reads each side of an interval session", () => {
    const z = { work: { zone: "Z4", low_bpm: 139, high_bpm: 157, source: "e" }, easy: Z2 };
    expect(workZoneText(z)).toBe("Z4 139–157 bpm");
    expect(easyZoneText(z)).toBe("Z2 105–122 bpm");
  });

  it("is null on a session with no zones at all", () => {
    expect(workZoneText(null)).toBeNull();
    expect(easyZoneText(undefined)).toBeNull();
  });
});

describe("extraLabel", () => {
  it("names the extras the template offers", () => {
    expect(extraLabel("core")).toBe("Core");
    expect(extraLabel("yoga_strength")).toBe("Yoga — Strength & Balance");
  });

  it("shows an unknown extra rather than swallowing it", () => {
    expect(extraLabel("grip_work")).toBe("grip work");
  });

  it("is null when there is no extra", () => {
    expect(extraLabel(null)).toBeNull();
    expect(extraLabel("")).toBeNull();
  });
});
