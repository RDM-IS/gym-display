import { describe, expect, it } from "vitest";
import {
  classifyHrZone,
  compareToTargetZone,
  MAX_HR_BPM,
  zoneRangeBpm,
} from "../src/lib/hr-zone";

describe("classifyHrZone", () => {
  it("returns 0 below Z1 (< 50% max)", () => {
    expect(classifyHrZone(60)).toBe(0); // 60/175 ≈ 0.34
  });

  it("classifies the standard zones at MAX_HR=175", () => {
    expect(classifyHrZone(Math.round(0.55 * MAX_HR_BPM))).toBe(1); // 96
    expect(classifyHrZone(Math.round(0.65 * MAX_HR_BPM))).toBe(2); // 114
    expect(classifyHrZone(Math.round(0.75 * MAX_HR_BPM))).toBe(3); // 131
    expect(classifyHrZone(Math.round(0.85 * MAX_HR_BPM))).toBe(4); // 149
    expect(classifyHrZone(Math.round(0.95 * MAX_HR_BPM))).toBe(5); // 166
  });

  it("returns 5 for bpm above Z5 ceiling", () => {
    expect(classifyHrZone(200)).toBe(5);
  });
});

describe("zoneRangeBpm", () => {
  it("returns the bpm range for a valid zone", () => {
    const z2 = zoneRangeBpm(2);
    expect(z2).not.toBeNull();
    if (z2) {
      expect(z2[0]).toBe(Math.round(0.60 * MAX_HR_BPM));
      expect(z2[1]).toBe(Math.round(0.70 * MAX_HR_BPM));
    }
  });

  it("returns null for an invalid zone", () => {
    expect(zoneRangeBpm(0)).toBeNull();
    expect(zoneRangeBpm(6)).toBeNull();
  });
});

describe("compareToTargetZone", () => {
  it("delta is positive when actual zone exceeds target", () => {
    // 165 bpm @ 175 max → Z5, target Z2 → delta = +3
    const c = compareToTargetZone(165, 2);
    expect(c.actualZone).toBe(5);
    expect(c.targetZone).toBe(2);
    expect(c.delta).toBe(3);
  });

  it("delta is negative when actual zone is below target", () => {
    // 100 bpm → Z1, target Z3 → delta = -2
    const c = compareToTargetZone(100, 3);
    expect(c.actualZone).toBe(1);
    expect(c.delta).toBe(-2);
  });

  it("attaches the target bpm range for context", () => {
    const c = compareToTargetZone(120, 2);
    expect(c.targetRangeBpm).not.toBeNull();
    if (c.targetRangeBpm) {
      expect(c.targetRangeBpm[0]).toBeGreaterThan(0);
      expect(c.targetRangeBpm[1]).toBeGreaterThan(c.targetRangeBpm[0]);
    }
  });
});
