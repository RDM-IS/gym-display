// GD-REST (2026-09-25) — a rest day must render, not throw.
//
// Migration 042 (EVENING-1) gave rest mornings their own session_type and
// blocks.type. The Blocks union did not know about it, so every switch fell
// through to assertNeverBlock and the iPad showed "Something broke —
// Unhandled blocks.type: rest" on every rest day.
import { describe, expect, it } from "vitest";
import { flattenBlocksToSteps } from "../src/lib/steps";
import { sessionLabel } from "../src/lib/format";
import type { Blocks } from "../src/lib/types";

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
