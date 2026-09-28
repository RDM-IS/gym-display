import type { SessionZones, ZoneTarget } from "./types";

/** "Z2 105–122 bpm". Returns null when the row does not carry usable numbers,
 * so a caller renders nothing rather than "undefined–undefined bpm". The zones
 * are an estimate until ZONE-1 measures them; `t.source` says so, and the
 * screen shows that on the setup card where there is room for it. */
export function zoneText(t: ZoneTarget | null | undefined): string | null {
  if (!t) return null;
  const { zone, low_bpm, high_bpm } = t;
  if (typeof low_bpm !== "number" || typeof high_bpm !== "number") return null;
  if (!Number.isFinite(low_bpm) || !Number.isFinite(high_bpm)) return null;
  const label = zone ? `${zone} ` : "";
  return `${label}${low_bpm}–${high_bpm} bpm`;
}

/** The work target, which is the one line worth showing when there is only room
 * for one. `easy` is the between-intervals target and is shown beside it. */
export function workZoneText(z: SessionZones | null | undefined): string | null {
  return zoneText(z?.work);
}

export function easyZoneText(z: SessionZones | null | undefined): string | null {
  return zoneText(z?.easy);
}

/** PROGRAM-2 suggested extras are session_type keys. These are the ones the
 * template offers; anything else falls back to the key with its underscores
 * removed, because a new extra should read oddly rather than not appear. */
const EXTRA_LABELS: Record<string, string> = {
  core: "Core",
  mobility: "Mobility",
  yoga_strength: "Yoga — Strength & Balance",
};

export function extraLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return EXTRA_LABELS[key] ?? key.replace(/_/g, " ");
}
