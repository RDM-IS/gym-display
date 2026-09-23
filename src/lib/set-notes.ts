import type { EquipmentClass } from "./equipment";

// ---------------------------------------------------------------------------
// Per-set notes written to health.session_log.notes. gym-display only writes
// structured tokens — quick flags, a machine setting and in-session pain.
// Subjective detail goes to @artemis in Mattermost.
//
//   "finisher; seat=4; pad=3; pain=shoulder:2; pain=low back:3; machine taken"
//
// Artemis reads `pain=` for pattern surfacing only (artemis/health_patterns.py),
// never for today's plan. The Status page flags any note containing "pain".
// ---------------------------------------------------------------------------

export const QUICK_FLAGS = ["skipped", "machine taken", "felt off", "form breakdown"] as const;
export type QuickFlag = (typeof QUICK_FLAGS)[number];

/** Classes with a seat / pad / range position worth recording. */
export function supportsSetting(cls: EquipmentClass): boolean {
  return cls === "machine" || cls === "cable" || cls === "smith";
}

/** Named machine positions (Ryan, 2026-09-19): each a separate number, written
 * as `seat=4; pad=3; range=2` — only the ones entered, always in this order. */
export const SETUP_FIELDS = ["seat", "pad", "range"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number];
export type MachineSetup = Partial<Record<SetupField, number>>;

export const SETUP_LABELS: Record<SetupField, string> = { seat: "Seat", pad: "Pad", range: "Range" };

export function hasSetup(s: MachineSetup | null | undefined): boolean {
  return !!s && SETUP_FIELDS.some((f) => s[f] != null);
}

/** "seat 4 · pad 3", or "" when nothing is set. */
export function formatSetup(s: MachineSetup | null | undefined): string {
  if (!s) return "";
  return SETUP_FIELDS.filter((f) => s[f] != null).map((f) => `${f} ${s[f]}`).join(" · ");
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
  setup?: MachineSetup | null;
  pain?: readonly PainEntry[];
  flags?: readonly QuickFlag[];
}): string | null {
  const parts: string[] = [];
  if (opts.finisher) parts.push("finisher");
  for (const f of SETUP_FIELDS) {
    const v = opts.setup?.[f];
    if (v != null) parts.push(`${f}=${v}`);
  }
  for (const p of opts.pain ?? []) parts.push(`pain=${p.region}:${p.level}`);
  for (const f of QUICK_FLAGS) {
    if (opts.flags?.includes(f)) parts.push(f);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

const FIELD_RE = (key: string) => new RegExp(`(?:^|;)\\s*${key}=(\\d+(?:\\.\\d+)?)\\s*(?=;|$)`);

/** The named positions in a notes string. A legacy single `setting=<n>`
 * (written before 2026-09-19) reads back as the seat. */
export function parseSetup(notes: string | null | undefined): MachineSetup {
  const out: MachineSetup = {};
  if (!notes) return out;
  for (const f of SETUP_FIELDS) {
    const m = notes.match(FIELD_RE(f));
    if (m) out[f] = Number(m[1]);
  }
  if (out.seat == null) {
    const legacy = notes.match(FIELD_RE("setting"));
    if (legacy) out.seat = Number(legacy[1]);
  }
  return out;
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

// ---------------------------------------------------------------------------
// GD-REST-TILES follow-up (Ryan, 2026-09-23): the rest screen's note repeated
// the prescription the tiles and the logger card already carry ("2×10-12; log
// seat + pin setting"). Keep the part that is actually a reminder.
// ---------------------------------------------------------------------------

/** A leading prescription — "2×10-12", "3x8-12", "2 × 12" — and whatever
 * separator follows it. Anchored, so "10 each side" is left alone. */
const PRESCRIPTION = /^\s*\d+\s*[×x]\s*\d+(?:\s*-\s*\d+)?\s*[;,.·|-]?\s*/i;

/** The exercise note with its prescription prefix removed, or null when
 * nothing else was there. */
export function setupReminder(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const rest = notes.replace(PRESCRIPTION, "").trim();
  return rest || null;
}
