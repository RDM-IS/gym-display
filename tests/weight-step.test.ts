import { describe, expect, it } from "vitest";
import { weightStepFor } from "../src/lib/weight-step";

describe("weightStepFor", () => {
  it("returns 0 + bodyweight=true for duration-format exercises", () => {
    expect(weightStepFor({ name: "Plank", format: "duration" })).toEqual({
      step: 0,
      isBodyweight: true,
    });
  });

  it("treats bodyweight-keyword movements as no-weight", () => {
    for (const name of ["Plank", "Push-up", "Incline push-up", "Dead bug", "Bird dog",
                        "Side plank", "Mountain climbers", "Glute bridge",
                        "TRX row", "TRX chest press", "Banded face pull",
                        "Hollow hold"]) {
      const w = weightStepFor({ name, format: "reps" });
      expect(w.isBodyweight).toBe(true);
      expect(w.step).toBe(0);
    }
  });

  it("returns 5 for goblet / DB / dumbbell / PowerBlock movements", () => {
    for (const name of ["Goblet squat", "DB RDL", "DB single-arm row",
                        "Dumbbell bench", "PowerBlock OHP"]) {
      const w = weightStepFor({ name, format: "reps" });
      expect(w.step).toBe(5);
      expect(w.isBodyweight).toBe(false);
    }
  });

  it("returns 10 for barbell movements", () => {
    for (const name of ["Barbell back squat", "Bench press", "Front squat"]) {
      const w = weightStepFor({ name, format: "reps" });
      expect(w.step).toBe(10);
    }
  });

  it("defaults to 2.5 for unknown weighted exercises", () => {
    const w = weightStepFor({ name: "Lateral raise", format: "reps" });
    expect(w.step).toBe(2.5);
    expect(w.isBodyweight).toBe(false);
  });
});
