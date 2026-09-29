import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { RESOURCE_LABELS, resourceLabel } from "../src/lib/prep-schedule";

/** One vocabulary for the lanes. The board's lanes said "Air fryer" and the
 * run-order list printed the raw `air_fryer` — a field name leaking onto a screen
 * he reads while cooking. */
describe("resource labels", () => {
  const RESOURCES = ["hands", "oven", "stove", "air_fryer", "counter", "fridge"] as const;

  it("every resource has a human label", () => {
    for (const r of RESOURCES) {
      expect(resourceLabel(r), r).toBeTruthy();
      expect(resourceLabel(r)).not.toContain("_");
    }
  });

  it("the map covers exactly the resource union and nothing else", () => {
    expect(Object.keys(RESOURCE_LABELS).sort()).toEqual([...RESOURCES].sort());
  });

  it("nothing renders a raw resource value", () => {
    // The specific regression: `{t.resource}` and `{task.resource}` in JSX. The
    // className interpolations are fine — those are selectors, not prose.
    for (const file of ["src/screens/PrepBoard.tsx", "src/components/PrepTimerRail.tsx"]) {
      const src = readFileSync(file, "utf8");
      // The negative lookbehind matters: `prep-timer--${task.resource}` is a
      // className and must NOT match. Without it this test failed on its own
      // stated exemption.
      const bare = src.match(/(?<!\$)\{(?:t|task|next)\.resource\}/g) ?? [];
      expect(bare, `${file} renders a raw resource`).toEqual([]);
    }
  });

  it("the oven lane separates its temperature from its name", () => {
    // "OVEN425°F" read as one word.
    const src = readFileSync("src/screens/PrepBoard.tsx", "utf8");
    expect(src).toContain('· {temps.join(" / ")}°F');
  });
});
