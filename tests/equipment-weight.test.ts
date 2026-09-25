import { describe, expect, it } from "vitest";
import type { LoadConfigByClass } from "../src/lib/types";
import {
  equipmentClassFor,
  type EquipmentClass,
} from "../src/lib/equipment";
import { platesPerSide, weightStepFor } from "../src/lib/weight-step";

// LOCATION-1 (2026-09-25): the office name map is GONE, and with it the suite
// that tested it. Names never imply a class again — "TRX row" read as
// `machine` and "Band pulldown" offered a 10 lb stack for a rubber band. The
// class comes from the row; an absent one is an explicit unknown, below.

describe("equipmentClassFor — the row decides, or nothing does", () => {
  it("takes the class from the row", () => {
    expect(equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: "smith" }))
      .toBe("smith");
  });

  it("is null when the row carries no class — nothing is inferred from the name", () => {
    expect(equipmentClassFor({ name: "Leg press", format: "reps" })).toBeNull();
    expect(equipmentClassFor({ name: "Leg press", format: "reps", equipment_class: null })).toBeNull();
  });

  it("is null for a class newer than this build, rather than a guess or a throw", () => {
    expect(equipmentClassFor({
      name: "Leg press", format: "reps",
      equipment_class: "kettlebell" as EquipmentClass,
    })).toBeNull();
  });

  it("the four the office name rules used to misread now come from the row", () => {
    const cases: Array<[string, EquipmentClass]> = [
      ["Band pulldown", "bands"],
      ["TRX row", "trx"],
      ["Ball hamstring curl", "bodyweight"],
      ["Lying leg raise", "bodyweight"],
    ];
    for (const [name, cls] of cases) {
      expect(equipmentClassFor({ name, format: "reps", equipment_class: cls })).toBe(cls);
    }
  });
});

//: What artemis sends for an office day, as a fixture. A FIXTURE, not config:
//: the real values live in knowledge/load_config.py and travel on the row.
const OFFICE: LoadConfigByClass = {
  dumbbell: { mode: "numeric", step: 5, min: 5, max: 45 },
  machine: { mode: "numeric", step: 10, min: 0, max: 300 },
  cable: { mode: "numeric", step: 10, min: 0, max: 200 },
  smith: { mode: "numeric", step: 10, min: 0, max: 240, bar: 0, plates: [45, 35, 25, 10, 5] },
  barbell: { mode: "numeric", step: 10, min: 45, max: 285, bar: 45, plates: [45, 35, 25, 10, 5] },
  bodyweight: { mode: "none" },
  cardio: { mode: "none" },
};

//: Richfield: PowerBlocks, a curl bar, bands, TRX. No cable stack, no machines.
const RICHFIELD: LoadConfigByClass = {
  dumbbell: { mode: "numeric", step: 5, min: 5, max: 50 },
  barbell: { mode: "numeric", step: 10, min: 25, max: 95, bar: 25, plates: [10, 10, 5, 5, 2.5] },
  bodyweight: { mode: "none" },
  bands: { mode: "none" },
  trx: { mode: "none" },
  cardio: { mode: "none" },
};

const ex = (name: string, equipment_class: EquipmentClass) =>
  ({ name, format: "reps" as const, equipment_class });

describe("weightStepFor — the row's config decides the stepper", () => {
  it("dumbbell → 5 lb, min and max from the row", () => {
    const w = weightStepFor(ex("DB bench press", "dumbbell"), OFFICE);
    expect(w).toMatchObject({ cls: "dumbbell", step: 5, loadMode: "numeric", showPlateMath: false });
    expect([w.min, w.max]).toEqual([5, 45]);
  });

  it("the SAME exercise loads differently at the two gyms", () => {
    const office = weightStepFor(ex("DB bench press", "dumbbell"), OFFICE);
    const farm = weightStepFor(ex("DB bench press", "dumbbell"), RICHFIELD);
    expect(office.max).toBe(45);
    expect(farm.max).toBe(50);
  });

  it("machine and cable take their step from the row", () => {
    expect(weightStepFor(ex("Leg press", "machine"), OFFICE)).toMatchObject({ step: 10 });
    expect(weightStepFor(ex("Cable face pull (rope)", "cable"), OFFICE).step).toBe(10);
  });

  it("smith / barbell offer reachable totals only, with plate math", () => {
    expect(weightStepFor(ex("Smith squat", "smith"), OFFICE))
      .toMatchObject({ cls: "smith", step: 10, showPlateMath: true });
    const bb = weightStepFor(ex("Barbell back squat", "barbell"), OFFICE);
    expect(bb).toMatchObject({ cls: "barbell", step: 10, showPlateMath: true, barLbs: 45 });
    expect(bb.values?.[0]).toBe(45);
    // the farm's curl bar is a different bar with different plates
    const farmBar = weightStepFor(ex("Barbell curl", "barbell"), RICHFIELD);
    expect(farmBar.barLbs).toBe(25);
    expect(farmBar.values?.[0]).toBe(25);
  });

  // ── the unknown states ──────────────────────────────────────────────────
  it("no class on the row → unknown, not a guess", () => {
    const w = weightStepFor({ name: "Leg press", format: "reps" }, OFFICE);
    expect(w).toMatchObject({ cls: null, loadMode: "unknown", step: 0 });
  });

  it("no config on the row → unknown, NOT the office", () => {
    const w = weightStepFor(ex("DB bench press", "dumbbell"));
    expect(w.loadMode).toBe("unknown");
    expect(w.max).toBe(0);
  });

  it("a class this gym does not have → unknown", () => {
    expect(weightStepFor(ex("Cable face pull (rope)", "cable"), RICHFIELD).loadMode).toBe("unknown");
    expect(weightStepFor(ex("Leg press", "machine"), RICHFIELD).loadMode).toBe("unknown");
  });

  it("bands, trx, bodyweight and cardio have NO load — a real answer, not a gap", () => {
    for (const cls of ["bands", "trx", "bodyweight", "cardio"] as EquipmentClass[]) {
      const w = weightStepFor(ex("Band pulldown", cls), RICHFIELD);
      expect(w.loadMode).toBe("none");
      expect(w.step).toBe(0);
    }
  });

  it("the four the name rules misread, resolved from the row", () => {
    expect(weightStepFor(ex("Band pulldown", "bands"), RICHFIELD))
      .toMatchObject({ cls: "bands", loadMode: "none" });
    expect(weightStepFor(ex("TRX row", "trx"), RICHFIELD))
      .toMatchObject({ cls: "trx", loadMode: "none" });
    expect(weightStepFor(ex("Ball hamstring curl", "bodyweight"), RICHFIELD))
      .toMatchObject({ cls: "bodyweight", loadMode: "none" });
    expect(weightStepFor(ex("Lying leg raise", "bodyweight"), RICHFIELD))
      .toMatchObject({ cls: "bodyweight", loadMode: "none" });
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

// EXERCISE-CLASS + LOCATION-1: the "row beats the name rules" suite lived here.
// There are no name rules left to beat — see "equipmentClassFor — the row
// decides, or nothing does" above.

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

  it("the row's config decides the range", () => {
    expect(weightStepFor(db, OFFICE).max).toBe(45);            // the office rack
    expect(weightStepFor(db, RICHFIELD).max).toBe(80);         // PowerBlocks
    expect(weightStepFor(db, RICHFIELD).step).toBe(5);
    expect(weightStepFor(db, RICHFIELD).loadMode).toBe("numeric");
  });

  it("no config means UNKNOWN — there is no office fallback (LOCATION-1)", () => {
    const w = weightStepFor(db);
    expect(w.loadMode).toBe("unknown");
    expect([w.min, w.max, w.step]).toEqual([0, 0, 0]);
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

  it("a class the gym does not have is UNKNOWN, not 'no load'", () => {
    // "no load" means the exercise genuinely has none (a band, bodyweight).
    // A cable at Richfield is different: there is no cable stack there at all,
    // so the honest answer is that this row does not say what a load means.
    // Richfield has no machines: a machine exercise there cannot be loaded
    const w = weightStepFor({ name: "Leg press", format: "reps", equipment_class: "machine" },
                            RICHFIELD);
    expect(w.loadMode).toBe("unknown");
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
    const w = weightStepFor({ name: "Barbell squat", format: "reps", equipment_class: "barbell" }, OFFICE);
    expect(w.barLbs).toBe(45);
    expect(w.values?.[0]).toBe(45);
  });
});
