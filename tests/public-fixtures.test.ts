import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// PUBLIC-FIXTURES: no test value may sit inside Ryan's real physiological range.
//
// This repo is PUBLIC. CLAUDE.md requires synthetic values OUTSIDE the real
// range — not merely values that happen not to match, because a reader cannot
// tell an in-range invented number from a recorded one.
//
// It was not being met. A scan on 2026-09-29 found 51 in-range values across 12
// files in the two repos, and tests/fixtures/overview.json carried
// `2026-09-16 → 284.5 lb`, an EXACT date-and-value match to health.daily_state.
// The 2026-09-25 history scan concluded the fixtures were all synthetic; that
// conclusion was wrong, and this test is what stops it being wrong again.
//
// The bands are deliberately WIDER than the recorded range (weight 280.5–286.0,
// resting HR 59–71 as of 2026-09-29): a value a pound outside it is still
// indistinguishable from a real one.

const WEIGHT_BAND: [number, number] = [265, 300];
const RHR_BAND: [number, number] = [52, 78];

const WEIGHT = /\b(\d{3})\.(\d)\b/g;
const WEIGHT_CTX = /weight|bodyweight|\blb\b|lbs/i;
const RHR = /(resting_hr|resting_heart_rate|\brhr\b)\D{0,14}?\b(\d{2})\b/gi;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|json)$/.test(p)) out.push(p);
  }
  return out;
}

const FILES = walk("tests").filter((f) => !f.endsWith("public-fixtures.test.ts"));

describe("no real physiology in fixtures", () => {
  it("has no weight inside the real range", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (!WEIGHT_CTX.test(line)) return;
        for (const m of line.matchAll(WEIGHT)) {
          const v = Number(m[0]);
          if (v >= WEIGHT_BAND[0] && v <= WEIGHT_BAND[1]) bad.push(`${f}:${i + 1} ${v}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("has no resting HR inside the real range", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(RHR)) {
          const v = Number(m[2]);
          if (v >= RHR_BAND[0] && v <= RHR_BAND[1]) bad.push(`${f}:${i + 1} ${v}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it("bites on a value that would slip through", () => {
    // A scan that cannot fail is not a guard.
    const line = '  "weight_lbs": 283.4,';
    expect(WEIGHT_CTX.test(line)).toBe(true);
    expect(Number([...line.matchAll(/\b(\d{3})\.(\d)\b/g)][0][0])).toBe(283.4);
  });
});
