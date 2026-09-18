import { afterEach, describe, expect, it } from "vitest";
import {
  equipmentClassFor,
  inferEquipmentClass,
  LOAD_CONFIG,
  STEP_OVERRIDES,
  type EquipmentClass,
} from "../src/lib/equipment";
import { platesPerSide, weightStepFor } from "../src/lib/weight-step";

describe("inferEquipmentClass — office gym name map", () => {
  const cases: Array<[string, EquipmentClass]> = [
    // machines
    ["Leg press", "machine"],
    ["Lat pulldown", "machine"],
    ["Seated cable row", "machine"],   // exact override: Pulldown/Seated Row machine
    ["Seated leg curl", "machine"],
    ["Leg extension", "machine"],
    ["Pec fly", "machine"],
    ["Rear delt fly", "machine"],
    ["Calf press", "machine"],
    ["Ab machine crunch", "machine"],
    ["Ab crunch", "machine"],
    ["Seated back extension", "machine"],  // Precor Abdominal / Back Extension (seated)
    // cable (S3.23)
    ["Cable face pull (rope)", "cable"],
    ["Cable Pallof press", "cable"],
    ["Single-arm cable row", "cable"],
    ["Rope pushdown", "cable"],
    ["Face pull", "cable"],
    // dumbbell
    ["DB bench press", "dumbbell"],
    ["DB goblet squat", "dumbbell"],
    ["Goblet squat", "dumbbell"],
    ["Incline DB press", "dumbbell"],
    ["DB Romanian deadlift", "dumbbell"],
    ["Seated DB shoulder press", "dumbbell"],
    ["Dumbbell curl", "dumbbell"],
    // smith / barbell
    ["Smith squat", "smith"],
    ["Barbell back squat", "barbell"],
    // bodyweight
    ["Captain's chair knee raise", "bodyweight"],
    ["Plank", "bodyweight"],
  ];
  for (const [name, cls] of cases) {
    it(`${name} → ${cls}`, () => {
      expect(inferEquipmentClass(name)).toBe(cls);
    });
  }

  it("returns null when nothing matches", () => {
    expect(inferEquipmentClass("Lateral raise")).toBeNull();
  });
});

describe("equipmentClassFor", () => {
  it("explicit blocks.exercises[].equipment_class wins over the name", () => {
    expect(equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: "smith" })).toBe("smith");
  });

  it("ignores an unknown explicit class and falls back to inference", () => {
    expect(
      equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: "kettlebell" as EquipmentClass }),
    ).toBe("machine");
  });

  it("duration-format work is bodyweight", () => {
    expect(equipmentClassFor({ name: "Stepmill or upright bike", format: "duration" })).toBe("bodyweight");
  });

  it("unknown reps exercise defaults to dumbbell", () => {
    expect(equipmentClassFor({ name: "Lateral raise", format: "reps" })).toBe("dumbbell");
  });
});

describe("weightStepFor — per-class increments", () => {
  afterEach(() => {
    for (const k of Object.keys(STEP_OVERRIDES)) delete STEP_OVERRIDES[k];
  });

  it("dumbbell → 5 lb with configurable min/max", () => {
    const w = weightStepFor({ name: "DB bench press", format: "reps" });
    expect(w).toMatchObject({ cls: "dumbbell", step: 5, isBodyweight: false, showPlateMath: false });
    expect(w.min).toBe(LOAD_CONFIG.dumbbell.min);
    expect(w.max).toBe(LOAD_CONFIG.dumbbell.max);
  });

  it("machine → stack step from config (default 10 lb)", () => {
    expect(weightStepFor({ name: "Leg press", format: "reps" })).toMatchObject({ cls: "machine", step: 10 });
  });

  it("cable → same step as machine", () => {
    expect(weightStepFor({ name: "Cable face pull (rope)", format: "reps" }).step).toBe(LOAD_CONFIG.machine.step);
  });

  it("machine / cable step is overridable per exercise", () => {
    STEP_OVERRIDES["lat pulldown"] = 12.5;
    STEP_OVERRIDES["cable pallof press"] = 5;
    expect(weightStepFor({ name: "Lat pulldown", format: "reps" }).step).toBe(12.5);
    expect(weightStepFor({ name: "Cable Pallof press", format: "reps" }).step).toBe(5);
    expect(weightStepFor({ name: "Leg press", format: "reps" }).step).toBe(10);
  });

  it("smith / barbell → 10 lb total steps over reachable totals only, with plate math", () => {
    expect(weightStepFor({ name: "Smith squat", format: "reps" })).toMatchObject({ cls: "smith", step: 10, showPlateMath: true });
    const bb = weightStepFor({ name: "Barbell back squat", format: "reps" });
    expect(bb).toMatchObject({ cls: "barbell", step: 10, showPlateMath: true, barLbs: 45 });
    expect(bb.values?.[0]).toBe(45);
  });

  it("bodyweight → no load stepper", () => {
    expect(weightStepFor({ name: "Captain's chair knee raise", format: "reps" })).toMatchObject({
      cls: "bodyweight", step: 0, isBodyweight: true,
    });
  });
});

describe("platesPerSide", () => {
  it("splits load above the bar evenly per side", () => {
    expect(platesPerSide(95, 45)).toBe(25);
    expect(platesPerSide(50, 45)).toBe(2.5);
  });

  it("returns null below the bar weight", () => {
    expect(platesPerSide(40, 45)).toBeNull();
  });
});
