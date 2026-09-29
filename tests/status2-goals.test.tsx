import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import GoalTiles, {
  CardioTile, NutritionTile, StrengthTile, WeightTile,
} from "../src/components/GoalTiles";
import {
  CardioDetailSection, NutritionDetailSection, SleepRecoverySection,
} from "../src/components/StatusDetail";
import type {
  CardioDetail, CardioGoal, Goals, NutritionDetail, NutritionGoal,
  SleepRecovery, StrengthGoal, WeightGoal,
} from "../src/lib/types";

// PUBLIC-FIXTURES: every number here is synthetic and outside the real range.
// artemis and gym-display are public repositories.

const OK = { ok: true, reason: null };
const DOWN = { ok: false, reason: "couldn't read weight" };

const weight: WeightGoal = {
  section: OK, avg_7d: 999.9, change_since_start: -9.9, lb_per_week: -9.99, days_7d: 7,
};
const cardio: CardioGoal = {
  section: OK, minutes_this_week: 77, minutes_target: 150, z2_minutes: 55, z4_minutes: 22,
  has_zone_data: true, interval_gate: "z2_variant",
  interval_gate_reason: "you haven't sent `intervals cleared` yet",
  interval_gate_date: "2099-01-02",
};
const strength: StrengthGoal = {
  section: OK, sessions_done: 2, sessions_planned: 5, lifts_progressed_14d: 3,
};
const nutrition: NutritionGoal = {
  section: OK, days_logged: 4, days_window: 7, avg_protein_g: 111, avg_fiber_g: 22,
  target_protein_g: null, target_fiber_g: null, target_set_by: null,
};

describe("an unreadable section says so and shows NO numbers", () => {
  it("is the rule for every tile", () => {
    const cases = [
      ["tile-weight", <WeightTile g={{ ...weight, section: DOWN }} />],
      ["tile-cardio", <CardioTile g={{ ...cardio, section: DOWN }} />],
      ["tile-strength", <StrengthTile g={{ ...strength, section: DOWN }} />],
      ["tile-nutrition", <NutritionTile g={{ ...nutrition, section: DOWN }} />],
    ] as const;
    for (const [id, el] of cases) {
      const { unmount } = render(el);
      const tile = screen.getByTestId(id);
      expect(tile.dataset.ok, id).toBe("0");
      expect(screen.getByTestId("tile-unreadable").textContent).toContain("couldn't read");
      // The number that WOULD have been shown must be absent. A 0 here would
      // read as "you did none", which is a training judgement, not a read error.
      expect(tile.querySelector(".tile-big"), id).toBeNull();
      unmount();
    }
  });

  it("shows the reason the API gave, not a generic one", () => {
    render(<CardioTile g={{ ...cardio, section: { ok: false, reason: "couldn't read cardio minutes" } }} />);
    expect(screen.getByTestId("tile-unreadable").textContent).toBe("couldn't read cardio minutes");
  });
});

describe("zero is an answer and is shown as one", () => {
  it("shows 0 cardio minutes when the read succeeded", () => {
    render(<CardioTile g={{ ...cardio, minutes_this_week: 0, has_zone_data: false }} />);
    expect(screen.getByTestId("tile-cardio").dataset.ok).toBe("1");
    expect(screen.getByTestId("cardio-minutes").textContent).toContain("0");
    expect(screen.queryByTestId("tile-unreadable")).toBeNull();
  });

  it("distinguishes no heart-rate data from zero minutes in a zone", () => {
    render(<CardioTile g={{ ...cardio, has_zone_data: false, z2_minutes: null, z4_minutes: null }} />);
    expect(screen.getByTestId("cardio-no-zones").textContent).toMatch(/no heart-rate data/i);
    expect(screen.queryByTestId("cardio-zones")).toBeNull();
  });

  it("shows the zone split when there IS heart-rate data", () => {
    render(<CardioTile g={cardio} />);
    expect(screen.getByTestId("cardio-zones").textContent).toContain("Z2 55 min");
    expect(screen.getByTestId("cardio-zones").textContent).toContain("Z4 22 min");
  });
});

describe("the interval gate is reported, never evaluated here", () => {
  it("names the failing condition when the next one runs Zone 2", () => {
    render(<CardioTile g={cardio} />);
    expect(screen.getByTestId("cardio-gate").textContent).toContain("Zone 2");
    expect(screen.getByTestId("cardio-gate").textContent).toContain("intervals cleared");
  });

  it("says so plainly when intervals are cleared", () => {
    render(<CardioTile g={{ ...cardio, interval_gate: "intervals", interval_gate_reason: null }} />);
    expect(screen.getByTestId("cardio-gate").textContent).toMatch(/cleared/i);
  });

  it("shows no gate line at all when there is no interval day ahead", () => {
    render(<CardioTile g={{ ...cardio, interval_gate: null }} />);
    expect(screen.queryByTestId("cardio-gate")).toBeNull();
  });
});

describe("the nutrition target is the dietitian's or nobody's", () => {
  it("says there is no target rather than inventing one", () => {
    render(<NutritionTile g={nutrition} />);
    expect(screen.getByTestId("nutrition-no-target").textContent).toMatch(/no dietitian target/i);
    expect(screen.getByTestId("nutrition-protein").textContent).not.toContain(" of ");
  });

  it("compares against a target only when one exists, and credits it", () => {
    render(<NutritionTile g={{
      ...nutrition, target_protein_g: 160, target_fiber_g: 30, target_set_by: "VA dietitian",
    }} />);
    expect(screen.getByTestId("nutrition-protein").textContent).toContain("of 160 g");
    expect(screen.getByTestId("nutrition-target-source").textContent).toContain("VA dietitian");
    expect(screen.queryByTestId("nutrition-no-target")).toBeNull();
  });
});

describe("absent values render as a dash, never as zero", () => {
  it("shows dashes when the read worked but there is nothing yet", () => {
    render(<WeightTile g={{
      section: OK, avg_7d: null, change_since_start: null, lb_per_week: null, days_7d: 0,
    }} />);
    expect(screen.getByTestId("weight-avg").textContent).toBe("—");
    expect(screen.getByTestId("weight-change").textContent).toContain("—");
  });

  it("flags partial weigh-in coverage", () => {
    render(<WeightTile g={{ ...weight, days_7d: 3 }} />);
    expect(screen.getByTestId("weight-coverage").textContent).toContain("3 of 7");
  });

  it("hides the coverage note when all seven days are there", () => {
    render(<WeightTile g={weight} />);
    expect(screen.queryByTestId("weight-coverage")).toBeNull();
  });
});

describe("all four tiles render together", () => {
  it("renders the goals in order", () => {
    const goals: Goals = { weight, cardio, strength, nutrition };
    render(<GoalTiles goals={goals} />);
    const ids = Array.from(screen.getByTestId("goal-tiles").children).map((c) =>
      (c as HTMLElement).dataset.testid ?? c.getAttribute("data-testid"));
    expect(ids).toEqual(["tile-weight", "tile-cardio", "tile-strength", "tile-nutrition"]);
  });
});

describe("the detail sections fail closed too", () => {
  const down = { ok: false, reason: "couldn't read cardio history" };

  it("cardio says so rather than showing an empty chart", () => {
    render(<CardioDetailSection detail={{ section: down, weeks: [], resting_hr: [] } as CardioDetail} />);
    expect(screen.getByTestId("cardio-unreadable").textContent).toContain("couldn't read");
  });

  it("nutrition says so", () => {
    render(<NutritionDetailSection detail={{ section: down, days: [] } as NutritionDetail} />);
    expect(screen.getByTestId("nutrition-unreadable")).toBeTruthy();
  });

  it("sleep says so", () => {
    render(<SleepRecoverySection detail={{ section: down, days: [] } as SleepRecovery} />);
    expect(screen.getByTestId("sleep and recovery-unreadable")).toBeTruthy();
  });

  it("an EMPTY but readable section reads as empty, not broken", () => {
    render(<CardioDetailSection detail={{ section: OK, weeks: [], resting_hr: [] } as CardioDetail} />);
    expect(screen.getByTestId("cardio-weeks-empty").textContent).toMatch(/no cardio logged/i);
    expect(screen.queryByTestId("cardio-unreadable")).toBeNull();
  });

  it("shows weekly minutes and the resting-HR trend", () => {
    render(<CardioDetailSection detail={{
      section: OK,
      weeks: [{ week_start: "2099-01-04", minutes: 90, sessions: 3 }],
      resting_hr: [{ date: "2099-01-04", value: 99 }, { date: "2099-01-05", value: 98 }],
    } as CardioDetail} />);
    expect(screen.getByTestId("cardio-weeks").textContent).toContain("90 min");
    expect(screen.getByTestId("rhr-trend").textContent).toContain("99 → 98 bpm");
  });
});

// ── Round #18 polish ──────────────────────────────────────────────────────

describe("the tile and the detail below it agree", () => {
  it("both say couldn't-read when the section is down", () => {
    // The Lambda now returns ONE status per domain (api: _nutrition returns the
    // tile and the detail together), so this is the shape the screen must honour
    // rather than something it derives.
    const down = { ok: false, reason: "couldn't read nutrition" };
    const { unmount } = render(<NutritionTile g={{ ...nutrition, section: down }} />);
    expect(screen.getByTestId("tile-unreadable").textContent).toBe("couldn't read nutrition");
    unmount();
    render(<NutritionDetailSection detail={{ section: down, days: [] } as NutritionDetail} />);
    expect(screen.getByTestId("nutrition-unreadable").textContent).toBe("couldn't read nutrition");
    // And neither shows numbers.
    expect(screen.queryByTestId("nutrition-7d")).toBeNull();
  });
});

describe("copy", () => {
  it("spells fiber the American way, on the tile and in the detail", () => {
    const { unmount } = render(<NutritionTile g={nutrition} />);
    expect(screen.getByTestId("nutrition-fiber").textContent).toContain("fiber");
    expect(screen.getByTestId("nutrition-fiber").textContent).not.toContain("fibre");
    unmount();
    render(<NutritionDetailSection detail={{
      section: OK,
      days: [{ day: "2099-01-07", kcal: 2100, protein_g: 111, fiber_g: 22, items: 4 }],
    } as NutritionDetail} />);
    const text = screen.getByTestId("nutrition-7d").textContent ?? "";
    expect(text).toContain("fiber");
    expect(text).not.toContain("fibre");
  });

  it("renders the backticked command as a chip, not as backticks", () => {
    render(<CardioTile g={cardio} />);
    const chip = screen.getByTestId("gate-chip");
    expect(chip.tagName).toBe("CODE");
    expect(chip.textContent).toBe("intervals cleared");
    // The raw punctuation must be gone from the rendered line.
    expect(screen.getByTestId("cardio-gate").textContent).not.toContain("`");
  });

  it("leaves a reason with no backticks alone", () => {
    render(<CardioTile g={{ ...cardio, interval_gate_reason: "only 1 of the last 6 are logged" }} />);
    expect(screen.getByTestId("cardio-gate").textContent).toContain("only 1 of the last 6");
    expect(screen.queryByTestId("gate-chip")).toBeNull();
  });

  it("keeps the readings count on the resting-HR line", () => {
    render(<CardioDetailSection detail={{
      section: OK, weeks: [],
      resting_hr: [{ date: "2099-01-04", value: 99 }, { date: "2099-01-05", value: 98 }],
    } as CardioDetail} />);
    // One element carries both halves, so they cannot wrap apart into what looks
    // like two separate facts.
    const line = screen.getByTestId("rhr-trend").querySelector(".st-rhr-line");
    expect(line?.textContent).toContain("99");
    expect(line?.textContent).toContain("2 readings");
  });
});

describe("ZONE-0: where the zone split came from", () => {
  it("labels a split derived from session averages", () => {
    // One hr_avg per session puts a whole interval session into whichever zone
    // its average landed in. That is not the same claim as measured minutes, so
    // the card says which it is rather than presenting them as equivalent.
    render(<CardioTile g={{ ...cardio, zone_source: "session_average" }} />);
    expect(screen.getByTestId("cardio-zone-source").textContent).toMatch(/session averages/i);
  });

  it("says nothing extra when the minutes came from the watch and cover the week", () => {
    render(<CardioTile g={{
      ...cardio, zone_source: "watch", zone_sessions: 3, zone_sessions_total: 3,
    }} />);
    expect(screen.queryByTestId("cardio-zone-source")).toBeNull();
    expect(screen.queryByTestId("cardio-zone-coverage")).toBeNull();
  });

  it("says how much of the week the watch actually covered", () => {
    render(<CardioTile g={{
      ...cardio, zone_source: "watch", zone_sessions: 1, zone_sessions_total: 4,
    }} />);
    expect(screen.getByTestId("cardio-zone-coverage").textContent).toContain("1 of 4");
  });

  it("still shows no-heart-rate-data when there is no split at all", () => {
    render(<CardioTile g={{
      ...cardio, has_zone_data: false, z2_minutes: null, z4_minutes: null, zone_source: null,
    }} />);
    expect(screen.getByTestId("cardio-no-zones").textContent).toMatch(/minutes logged only/i);
    expect(screen.queryByTestId("cardio-zones")).toBeNull();
  });
});
