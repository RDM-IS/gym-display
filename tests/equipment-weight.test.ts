import { afterEach, describe, expect, it } from "vitest";
import type { LoadConfigByClass } from "../src/lib/types";
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

// ── EXERCISE-CLASS (Ryan, 2026-09-23): the row's class is authoritative ─────
describe("where the equipment class comes from", () => {
  it("the row's class beats the name rules", () => {
    // the office rules read both of these as `machine`
    expect(inferEquipmentClass("TRX row")).toBe("machine");
    expect(equipmentClassFor({ name: "TRX row", format: "reps", equipment_class: "machine" }))
      .toBe("machine");
    expect(equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: "dumbbell" }))
      .toBe("dumbbell");
  });

  it("falls back to the name only when the row carries no class", () => {
    expect(equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: null }))
      .toBe("machine");
    expect(equipmentClassFor({ name: "Leg press", format: "reps" })).toBe("machine");
  });

  it("a class this build does not know falls back instead of throwing", () => {
    // A class newer than this build falls back to the name rules rather than
    // breaking. `bands` used to stand in here; LOCATION-1 makes it a KNOWN
    // class, so the example has to be one that is still unknown.
    const ex = { name: "Leg press", format: "reps" as const,
                 equipment_class: "kettlebell" as unknown as EquipmentClass };
    expect(equipmentClassFor(ex)).toBe("machine");
    expect(() => weightStepFor(ex)).not.toThrow();
  });
});

// ── LOCATION-1 (Ryan, 2026-09-23): the load config travels on the row ───────
describe("what a load means where the session happens", () => {
  /** Richfield, exactly as artemis seeds it into blocks.load_config. */
  const RICHFIELD = {
    dumbbell: { mode: "numeric", step: 5, min: 5, max: 80 },
    barbell: { mode: "numeric", step: 10, min: 0, max: 70, bar: 0, plates: [10, 10, 5, 5, 2.5] },
    bands: { mode: "none" },
    trx: { mode: "none" },
    bodyweight: { mode: "none" },
    cardio: { mode: "none" },
  } as LoadConfigByClass;

  const db = { name: "DB bench press", format: "reps", equipment_class: "dumbbell" } as const;

  it("the row's config wins over the office defaults", () => {
    expect(weightStepFor(db).max).toBe(45);                    // the office rack
    expect(weightStepFor(db, RICHFIELD).max).toBe(80);         // PowerBlocks
    expect(weightStepFor(db, RICHFIELD).step).toBe(5);
    expect(weightStepFor(db, RICHFIELD).loadMode).toBe("numeric");
  });

  it("no config means the office — every row seeded before LOCATION-1", () => {
    const office = weightStepFor(db);
    expect([office.min, office.max, office.step]).toEqual([5, 45, 5]);
    expect(office.loadMode).toBe("numeric");
  });

  it("bands, trx and cardio have no stepper at all", () => {
    for (const cls of ["bands", "trx", "cardio", "bodyweight"] as const) {
      const w = weightStepFor({ name: "Band pulldown", format: "reps" as const,
                                equipment_class: cls }, RICHFIELD);
      expect(w.loadMode, cls).toBe("none");
      expect(w.isBodyweight, cls).toBe(true);
      expect(w.step, cls).toBe(0);
    }
  });

  it("a class the gym does not have gets no stepper either", () => {
    // Richfield has no machines: a machine exercise there cannot be loaded
    const w = weightStepFor({ name: "Leg press", format: "reps", equipment_class: "machine" },
                            RICHFIELD);
    expect(w.loadMode).toBe("none");
  });

  it("plate math comes from the row's own plates", () => {
    const bar = { name: "Curl bar row", format: "reps", equipment_class: "barbell" } as const;
    const w = weightStepFor(bar, RICHFIELD);
    expect(w.showPlateMath).toBe(true);
    expect(w.barLbs).toBe(0);
    // the curl bar's set: 10+10+5+5+2.5 per side = 32.5, so 65 lb is the top
    expect(w.values?.[w.values.length - 1]).toBe(65);
    expect(w.values).toContain(20);          // a 10 per side
    expect(w.values).not.toContain(90);      // the office's plates are not here
  });

  it("the office still gets the office bar and plates", () => {
    const w = weightStepFor({ name: "Barbell squat", format: "reps", equipment_class: "barbell" });
    expect(w.barLbs).toBe(45);
    expect(w.values?.[0]).toBe(45);
  });
});
