import type { EquipmentClass } from "./equipment";

// ---------------------------------------------------------------------------
// Per-set notes written to health.session_log.notes. gym-display only writes
// structured tokens — quick flags, a machine setting and in-session pain.
// Subjective detail goes to @artemis in Mattermost.
//
//   "finisher; setting=7; pain=shoulder:2; pain=low back:3; machine taken; felt off"
//
// Artemis reads `pain=` for pattern surfacing only (artemis/health_patterns.py),
// never for today's plan. The Status page flags any note containing "pain".
// ---------------------------------------------------------------------------

export const QUICK_FLAGS = ["skipped", "machine taken", "felt off", "form breakdown"] as const;
export type QuickFlag = (typeof QUICK_FLAGS)[number];

/** Classes with a seat / pin / setting worth recording. */
export function supportsSetting(cls: EquipmentClass): boolean {
  return cls === "machine" || cls === "cable" || cls === "smith";
}

/** Artemis's check-in region vocabulary (artemis/health_regions.py REGIONS). */
export const PAIN_REGIONS = [
  "shoulder", "chest", "back", "low back", "arms", "biceps", "triceps",
  "legs", "quads", "hamstrings", "calves", "core", "knee", "hip", "neck",
] as const;
export type PainRegion = (typeof PAIN_REGIONS)[number];

export const PAIN_LEVELS = [0, 1, 2, 3, 4, 5] as const;

export interface PainEntry {
  region: PainRegion;
  level: number;
}

/** Add or replace one region's rating; order is the order regions were added. */
export function upsertPain(entries: readonly PainEntry[], entry: PainEntry): PainEntry[] {
  const i = entries.findIndex((e) => e.region === entry.region);
  if (i === -1) return [...entries, entry];
  return entries.map((e, j) => (j === i ? entry : e));
}

export function composeSetNotes(opts: {
  finisher?: boolean;
  setting?: number | null;
  pain?: readonly PainEntry[];
  flags?: readonly QuickFlag[];
}): string | null {
  const parts: string[] = [];
  if (opts.finisher) parts.push("finisher");
  if (opts.setting != null) parts.push(`setting=${opts.setting}`);
  for (const p of opts.pain ?? []) parts.push(`pain=${p.region}:${p.level}`);
  for (const f of QUICK_FLAGS) {
    if (opts.flags?.includes(f)) parts.push(f);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

const SETTING_RE = /(?:^|;\s*)setting=(-?\d+(?:\.\d+)?)(?:\s*;|\s*$)/;

/** The `setting=<n>` value from a notes string, or null. */
export function parseSetting(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = notes.match(SETTING_RE);
  return m ? Number(m[1]) : null;
}

const PAIN_RE = /(?:^|;)\s*pain=([a-z][a-z ]*?)\s*:\s*([0-5])\s*(?=;|$)/g;

/** Every `pain=<region>:<n>` entry in a notes string (known regions, 0–5). */
export function parsePain(notes: string | null | undefined): PainEntry[] {
  if (!notes) return [];
  const out: PainEntry[] = [];
  for (const m of notes.matchAll(PAIN_RE)) {
    const region = m[1].trim() as PainRegion;
    if ((PAIN_REGIONS as readonly string[]).includes(region)) {
      out.push({ region, level: Number(m[2]) });
    }
  }
  return out;
}
