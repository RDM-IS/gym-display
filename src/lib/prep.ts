/** PREP-1 — the Prep board's types and its reads.
 *
 * Everything here is RENDERED, not derived. The box and the Lambda decide what
 * to buy, how many packages, which store and which aisle; this file carries the
 * shapes and the fetches. The same rule the zone numbers follow (one place the
 * answer is decided) applies to the shopping arithmetic: a quantity computed
 * here would be a second answer, and it would be the one on screen.
 */

/** Why a line needs a human to look at it. Not errors — reasons. */
export type PrepFlag =
  | "no_store"
  | "no_rank1"
  | "top_up"
  | "count_unknown"
  | "no_package_size"
  | "no_unit"
  | "par_only"
  | "no_servings";

/** What each flag says, in Ryan's terms rather than the field name. */
export const FLAG_LABELS: Record<PrepFlag, string> = {
  no_store: "no store sells this",
  no_rank1: "second choice store",
  top_up: "buy some mid-stay",
  count_unknown: "never counted",
  no_package_size: "no package size",
  no_unit: "no unit set",
  par_only: "staple restock",
  no_servings: "recipe has no serving count",
};

export interface PrepLine {
  ingredient_id: string;
  name: string | null;
  category: string | null;
  unit: string | null;
  as_used_base: number;
  purchased_base: number;
  yield_factor: number;
  /** null means never counted — NOT zero. The two must render differently. */
  on_hand_base: number | null;
  par_level_pkgs: number | null;
  required_base: number;
  short_base: number;
  /** null means the package count is unknowable, not that none are needed. */
  packages: number | null;
  package_size: number | null;
  package_label: string | null;
  price: number | null;
  store: string | null;
  store_chain: string | null;
  store_id: string | null;
  rank: number | null;
  rank_basis: "override" | "notion" | "seed" | "none";
  aisle: string;
  packages_now: number | null;
  packages_later: number | null;
  later_day: string | null;
  flags: PrepFlag[];
}

export interface PrepAisle {
  aisle: string;
  items: PrepLine[];
}

export interface PrepStoreGroup {
  store: string | null;
  chain: string | null;
  store_id: string | null;
  rank: number | null;
  item_count: number;
  aisles: PrepAisle[];
}

export interface PrepSyncRow {
  db: string;
  status: string | null;
  rows_in_rds: number;
  last_run: string | null;
  last_full_sweep: string | null;
  detail: string | null;
}

export interface PrepStay {
  id: number;
  start_date: string;
  end_date: string;
  days: number;
  shop_date: string | null;
  source: string;
  confirmed: boolean;
}

export interface ShoppingResponse {
  stay: PrepStay;
  stores: PrepStoreGroup[];
  item_count: number;
  flags: Partial<Record<PrepFlag, number>>;
  day_count: number;
  menu_days: { day: string; meals: number }[];
  sync: { databases: PrepSyncRow[]; blocked: string[] };
  /** True when an unsynced database has removed quantities or stores from the
   * calculation. A SHORT list that looks finished is the failure this exists to
   * make loud — see knowledge/prep_store.py sync_status(). */
  incomplete: boolean;
}

export interface PantryItem {
  ingredient_id: string;
  name: string | null;
  category: string | null;
  unit: string | null;
  on_hand_base: number | null;
  on_hand_pkgs: number | null;
  counted_at: string | null;
  count_source: string | null;
  package_size: number | null;
  package_label: string | null;
  store: string | null;
  par_level_pkgs: number | null;
  shelf_life_days: number | null;
  countable_in_packages: boolean;
}

export interface PantryResponse {
  items: PantryItem[];
  count: number;
  uncounted: number;
}

export interface MacroChip {
  macro: string;
  value: number;
  target: number;
  direction: "over" | "under";
}

export interface MacroDay {
  day: string;
  meals: number;
  /** null when the day has no menu at all. NOT a set of zeroes: chips computed
   * from zero would say "under every target", which is true of an empty day in
   * the way that is useless. */
  totals: Record<string, number> | null;
  /** The day is in the stay and has no menu — a gap to fill, not a day that is
   * fine. Sunday 10/04 was simply missing from the list before this. */
  no_menu: boolean;
  chips: MacroChip[];
  /** Targets with no data source at all. Rendered as "no data", never as met:
   * Notion recipes carry no sugar figure, and a zero would read as "under". */
  no_data: string[];
  placeholder: boolean;
  missing: string[];
}

export interface MacrosResponse {
  target: Record<string, number | string | boolean | null> | null;
  days: MacroDay[];
  detail?: string;
}

// Re-exported so existing importers keep working; the spellings live in
// src/lib/macros.ts, which Status reads too. This file used to hold a SECOND copy
// that said "fibre" while Status said "fiber".
export { MACRO_LABELS, macroLabel } from "./macros";

/** A quantity with its unit, or an explicit dash. Never a bare 0 for unknown. */
export function fmtBase(value: number | null, unit: string | null): string {
  if (value === null || value === undefined) return "—";
  const n = Math.round(value * 10) / 10;
  return unit ? `${n} ${unit}` : `${n}`;
}

/** "2 × 32 oz carton", or "2" when the package has no printed label.
 *
 * ZERO DROPS THE LABEL. "0 × 1.5 lb pack" reads like a quantity of something;
 * "0" reads like the answer, which for a top-up row is "not on this trip". The
 * distinction from `null` is preserved either way: null is "—", meaning nobody
 * has said how big a package is, and that is a different statement entirely. */
export function fmtPackages(packages: number | null, label: string | null): string {
  if (packages === null || packages === undefined) return "—";
  if (packages === 0) return "0";
  return label ? `${packages} × ${label}` : `${packages}`;
}

// ── PREP-2: the board and the steps editor ──────────────────────────────────

import type { KitchenProfile, PrepRecipeInput } from "./prep-schedule";

export interface PrepBoardResponse {
  stay: { id: number; start_date: string; end_date: string };
  recipes: PrepRecipeInput[];
  /** recipes with servings to cook and NO steps. Named rather than dropped: that
   * is work the board cannot show, and silence would read as nothing to do. */
  stepless: string[];
  kitchen: KitchenProfile;
}

export interface PrepStepRow {
  step_id: number | null;
  step_no: number;
  name: string;
  resource: string;
  mode: string;
  base_min: number | null;
  per_serving_min: number | null;
  temp_f: number | null;
  batch_key: string | null;
  /** null = a BARRIER waiting for every chain in the recipe. */
  chain_key: string | null;
  keep_separate: boolean;
  keep_separate_note: string | null;
  shortcut_key: string | null;
  notes: string | null;
}

export interface PrepStepRecipe {
  recipe_id: string;
  name: string | null;
  slug: string | null;
  servings: number | null;
  plan_eligible: boolean;
  steps: PrepStepRow[];
}

export interface PrepStepsResponse {
  recipes: PrepStepRecipe[];
  with_steps: number;
  without_steps: number;
  resources: string[];
  modes: string[];
}

export interface PrepStepPayload {
  step_no: number;
  name: string;
  resource: string;
  mode: string;
  base_min: number;
  per_serving_min: number;
  temp_f: number | null;
  batch_key: string | null;
  chain_key: string | null;
  keep_separate: boolean;
  keep_separate_note: string | null;
  shortcut_key: string | null;
  notes: string | null;
}
