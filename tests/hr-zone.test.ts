import { describe, expect, it } from "vitest";
import {
  classifyHrZone,
  compareToTargetZone,
  MAX_HR_BPM,
  targetZoneLabel,
  zoneArrow,
  zoneLabel,
  zoneRangeBpm,
} from "../src/lib/hr-zone";

describe("MAX_HR_BPM (single source of truth)", () => {
  it("defaults to 172 (220 − 48 age-based)", () => {
    expect(MAX_HR_BPM).toBe(172);
  });
});

describe("classifyHrZone", () => {
  it("returns 0 below Z1 (< 50% of max)", () => {
    expect(classifyHrZone(60)).toBe(0); // 60/172 ≈ 0.35
  });

  it("classifies the standard zones — boundaries are %max-HR fixed", () => {
    expect(classifyHrZone(Math.round(0.55 * MAX_HR_BPM))).toBe(1); // 95
    expect(classifyHrZone(Math.round(0.65 * MAX_HR_BPM))).toBe(2); // 112
    expect(classifyHrZone(Math.round(0.75 * MAX_HR_BPM))).toBe(3); // 129
    expect(classifyHrZone(Math.round(0.85 * MAX_HR_BPM))).toBe(4); // 146
    expect(classifyHrZone(Math.round(0.95 * MAX_HR_BPM))).toBe(5); // 163
  });

  it("classifies bpm ≥ Z5 lower bound (90% max) as Zone 5", () => {
    expect(classifyHrZone(155)).toBe(5);  // 155/172 ≈ 0.901
    expect(classifyHrZone(172)).toBe(5);  // exactly 100%
    expect(classifyHrZone(200)).toBe(5);  // above ceiling — still Z5
  });

  it("returns 0 for zero or negative bpm", () => {
    expect(classifyHrZone(0)).toBe(0);
    expect(classifyHrZone(-5)).toBe(0);
  });
});

describe("zoneRangeBpm", () => {
  it("Z2 spans 60-70% of max", () => {
    const z2 = zoneRangeBpm(2);
    expect(z2).toEqual([Math.round(0.60 * MAX_HR_BPM), Math.round(0.70 * MAX_HR_BPM)]);
    expect(z2).toEqual([103, 120]);
  });

  it("Z5 caps at 100% (NOT 105%)", () => {
    const z5 = zoneRangeBpm(5);
    expect(z5).toEqual([Math.round(0.90 * MAX_HR_BPM), MAX_HR_BPM]);
    expect(z5).toEqual([155, 172]);
  });

  it("returns null for invalid zones", () => {
    expect(zoneRangeBpm(0)).toBeNull();
    expect(zoneRangeBpm(6)).toBeNull();
  });
});

describe("zoneLabel — per-spec '{bpm} bpm = Zone {Z}' format", () => {
  it("renders 160 bpm as Zone 5", () => {
    // 160/172 = 0.93 → Z5 (since lower bound is 0.90)
    expect(zoneLabel(160)).toBe("160 bpm = Zone 5");
  });

  it("renders 130 bpm as Zone 3", () => {
    // 130/172 = 0.756 → Z3 (Z3 is 70-80%)
    expect(zoneLabel(130)).toBe("130 bpm = Zone 3");
  });

  it("renders bpm below Z1 explicitly (not 'Zone 0')", () => {
    expect(zoneLabel(50)).toBe("50 bpm = below Z1");
  });
});

describe("targetZoneLabel", () => {
  it("renders 'Zone N (lo-hi bpm)'", () => {
    expect(targetZoneLabel(3)).toBe("Zone 3 (120–138 bpm)");
    expect(targetZoneLabel(2)).toBe("Zone 2 (103–120 bpm)");
  });

  it("null for invalid zone", () => {
    expect(targetZoneLabel(0)).toBeNull();
  });
});

describe("compareToTargetZone + zoneArrow", () => {
  it("delta is positive when actual zone exceeds target", () => {
    const c = compareToTargetZone(160, 2); // 160 → Z5; target Z2
    expect(c.actualZone).toBe(5);
    expect(c.delta).toBe(3);
    expect(zoneArrow(c.actualZone, c.targetZone)).toBe("↑");
  });

  it("delta is negative when actual zone is below target", () => {
    const c = compareToTargetZone(100, 3); // 100 → Z1; target Z3
    expect(c.actualZone).toBe(1);
    expect(c.delta).toBe(-2);
    expect(zoneArrow(c.actualZone, c.targetZone)).toBe("↓");
  });

  it("arrow ≈ when actual = target", () => {
    const c = compareToTargetZone(135, 3); // 135 → Z3; target Z3
    expect(c.delta).toBe(0);
    expect(zoneArrow(c.actualZone, c.targetZone)).toBe("≈");
  });

  it("attaches the target bpm range for context", () => {
    const c = compareToTargetZone(135, 3);
    expect(c.targetRangeBpm).toEqual([120, 138]);
  });
});
