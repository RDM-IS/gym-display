import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ZONE-1 / PROGRAM-2: HR zone numbers live on the ROW. artemis resolves them in
// knowledge/zones.py and sends {zone, low_bpm, high_bpm, source}; this repo
// renders what it is given and derives nothing.
//
// src/lib/hr-zone.ts used to derive every zone from a local constant (220 − 48,
// which is also the wrong age now). Its header called itself "the single source
// of truth for the gym-display" and NOTHING imported it except its own test, so
// it was an authoritative-sounding second answer, disagreeing with the rows by
// ~2 bpm and waiting for someone to wire it up. It is deleted, and this test is
// what stops it coming back — in that file or any other.
//
// What is forbidden is a DECLARED CONSTANT or a derivation. Naming the numbers
// in a comment, a type field (`low_bpm`), or a test fixture is fine and wanted:
// the point is that there is one place they are decided, not that the words
// cannot be written down.

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

const SELF = "one-zone-source.test.ts";
const SRC = walk("src").filter((f) => !f.endsWith(SELF));
const ALL = [...walk("src"), ...walk("tests")].filter((f) => !f.endsWith(SELF));

/** `const MAX_HR_BPM = 172`, `let hrMax = …`, `RESTING_BPM: 60` — a number this
 * repo decided for itself. */
const DECLARED_HR_CONSTANT = /(?:const|let|var|readonly)\s+[A-Za-z_$][\w$]*(?:HR|BPM|Hr|Bpm)[\w$]*\s*(?::[^=\n]+)?=\s*-?\d/;

function offenders(files: string[], re: RegExp): string[] {
  return files.filter((f) => re.test(readFileSync(f, "utf8")));
}

describe("there is one source of HR zone numbers", () => {
  it("declares no heart-rate constant of its own, anywhere", () => {
    expect(offenders(ALL, DECLARED_HR_CONSTANT)).toEqual([]);
  });

  it("does not derive a zone from a percentage of a maximum", () => {
    expect(offenders(ALL, /ZONE_BANDS|classifyHrZone|zoneRangeBpm|targetZoneLabel/)).toEqual([]);
  });

  it("has no hr-zone module left to import", () => {
    expect(offenders(ALL, /from\s+["'].*hr-zone["']/)).toEqual([]);
    expect(walk("src").some((f) => f.endsWith("hr-zone.ts"))).toBe(false);
  });

  it("reads the range off the row instead", () => {
    // The one derivation that IS allowed is formatting: zones.ts turns the row's
    // numbers into text and invents none of its own.
    const zones = readFileSync("src/lib/zones.ts", "utf8");
    expect(zones).toMatch(/low_bpm/);
    expect(offenders(SRC, DECLARED_HR_CONSTANT)).toEqual([]);
  });
});
