import type { EquipmentClass } from "./equipment";

// ---------------------------------------------------------------------------
// Per-set notes written to health.session_log.notes. gym-display only writes
// structured tokens — quick flags and a machine setting. Subjective detail goes
// to @artemis in Mattermost.
//
//   "finisher; setting=7; machine taken; felt off"
// ---------------------------------------------------------------------------

export const QUICK_FLAGS = ["skipped", "machine taken", "felt off", "form breakdown"] as const;
export type QuickFlag = (typeof QUICK_FLAGS)[number];

/** Classes with a seat / pin / setting worth recording. */
export function supportsSetting(cls: EquipmentClass): boolean {
  return cls === "machine" || cls === "cable" || cls === "smith";
}

export function composeSetNotes(opts: {
  finisher?: boolean;
  setting?: number | null;
  flags?: readonly QuickFlag[];
}): string | null {
  const parts: string[] = [];
  if (opts.finisher) parts.push("finisher");
  if (opts.setting != null) parts.push(`setting=${opts.setting}`);
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
