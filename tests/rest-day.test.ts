// GD-REST (2026-09-25) — a rest day must render, not throw.
//
// Migration 042 (EVENING-1) gave rest mornings their own session_type and
// blocks.type. The Blocks union did not know about it, so every switch fell
// through to assertNeverBlock and the iPad showed "Something broke —
// Unhandled blocks.type: rest" on every rest day.
import { describe, expect, it } from "vitest";
import { flattenBlocksToSteps } from "../src/lib/steps";
import { sessionLabel } from "../src/lib/format";
import { nextSessionFrom as nextSession } from "../src/lib/week";
import type { Blocks, PlanDay } from "../src/lib/types";

/** Exactly what GET /api/health/today returned for 2026-09-25, captured live
 * before the fix. Synthetic values only — no logged data (PUBLIC-FIXTURES). */
const REST_BLOCKS: Blocks = {
  type: "rest",
  notes: "Rest. Nothing planned this morning.",
  equipment: [],
  display_name: "Rest",
};

describe("a rest day", () => {
  it("flattens to no steps instead of throwing", () => {
    expect(() => flattenBlocksToSteps(REST_BLOCKS)).not.toThrow();
    expect(flattenBlocksToSteps(REST_BLOCKS).steps).toHaveLength(0);
  });

  it("keeps the block as its source, so the screen can read notes and location", () => {
    const flat = flattenBlocksToSteps(REST_BLOCKS);
    expect(flat.source).toBe(REST_BLOCKS);
    expect(flat.sections).toHaveLength(0);
  });

  it("has a session label, so the week and plan views can name it", () => {
    expect(sessionLabel({ session_type: "rest" })).toBe("Rest");
  });

  it("still throws for a type nothing knows — the guard is intact", () => {
    expect(() => flattenBlocksToSteps({ type: "hologram" } as unknown as Blocks))
      .toThrow(/Unhandled blocks.type: hologram/);
  });
});

// EVENING-1: "next" spans both slots. A rest morning usually has a recovery
// flow that same evening, and that is tonight — not the next strength day.
describe("what counts as the next session", () => {
  const TODAY = "2026-09-25";
  const day = (d: string, slot: "morning" | "evening", session_type: string, extra = {}) =>
    ({ plan_date: d, slot, session_type, is_skipped: false, ...extra }) as unknown as PlanDay;

  it("picks tonight's evening flow over a later strength day", () => {
    const days = [
      day(TODAY, "morning", "rest"),
      day(TODAY, "evening", "recovery_flow"),
      day("2026-09-29", "morning", "strength_a"),
    ];
    expect(nextSession(days, TODAY)?.plan_date).toBe(TODAY);
    expect(nextSession(days, TODAY)?.session_type).toBe("recovery_flow");
  });

  it("never picks today's own rest morning", () => {
    const days = [day(TODAY, "morning", "rest"), day("2026-09-29", "morning", "strength_a")];
    expect(nextSession(days, TODAY)?.plan_date).toBe("2026-09-29");
  });

  it("skips rest, rest_mobility and skipped days in either slot", () => {
    const days = [
      day(TODAY, "evening", "rest_mobility"),
      day("2026-09-26", "morning", "strength_b", { is_skipped: true }),
      day("2026-09-26", "evening", "recovery_flow"),
    ];
    expect(nextSession(days, TODAY)?.plan_date).toBe("2026-09-26");
    expect(nextSession(days, TODAY)?.slot).toBe("evening");
  });

  it("returns null when nothing in the window is a session", () => {
    expect(nextSession([day("2026-09-26", "morning", "rest")], TODAY)).toBeNull();
  });
});
