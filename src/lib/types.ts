import type { EquipmentClass } from "./equipment";

export type { EquipmentClass };

export type SessionType =
  | "strength_a"
  | "strength_b"
  | "strength_c"
  | "cardio_intervals"
  | "cardio_z2"
  | "walk"
  | "rest_mobility";

export type ExerciseFormat = "reps" | "duration";

/** Planned (target) exercise — appears in main blocks and in finishers. */
export interface PlannedExercise {
  name: string;
  format: ExerciseFormat;
  target_reps?: number | null;
  target_load_lbs?: number | null;
  duration_sec?: number | null;
  rest_after_sec?: number | null;
  notes?: string | null;
  /** Optional explicit class; otherwise inferred from the name (equipment.ts). */
  equipment_class?: EquipmentClass | null;
}

/** Legacy name kept as alias for the circuit-exercise tests. */
export type CircuitExercise = PlannedExercise;

/** Finisher block — can attach to any main block. */
export interface Finisher {
  type?: string | null;
  rounds?: number | null;
  exercises?: PlannedExercise[] | null;
  rest_after_sec?: number | null;
  display_name?: string | null;
}

/** Fields shared by every blocks variant. */
interface BlocksBase {
  display_name?: string | null;
  equipment?: string[] | null;
  setup_notes?: string[] | null;
  finisher?: Finisher | null;
}

export interface IntervalsTemplate {
  work_sec: number;
  work_settings?: string | null;
  rest_sec: number;
  rest_settings?: string | null;
}

export interface CircuitBlocks extends BlocksBase {
  type: "circuit";
  warmup?: string | null;
  rounds?: number | null;
  rest_between_rounds_sec?: number | null;
  /** May be absent — earlier seed plans always carried this, but the
   * runtime payload is JSONB and not enforced. Treat as optional. */
  exercises?: PlannedExercise[] | null;
  cooldown?: string | null;
}

export interface IntervalsBlocks extends BlocksBase {
  type: "intervals";
  warmup_sec?: number | null;
  warmup_settings?: string | null;
  intervals_template: IntervalsTemplate;
  rounds?: number | null;
  cooldown_sec?: number | null;
  cooldown_settings?: string | null;
}

/** Cardio steady block (e.g. "Long Z2 Bike"). NO top-level exercises array. */
export interface SteadyBlocks extends BlocksBase {
  type: "steady";
  warmup_sec?: number | null;
  warmup_settings?: string | null;
  cooldown_sec?: number | null;
  cooldown_settings?: string | null;
  intensity?: string | null;
  duration_min: number;
  target_range_min?: [number, number] | string | null;
}

/** Mobility / rest day block. */
export interface MobilityBlocks extends BlocksBase {
  type: "mobility";
  notes?: string | null;
  duration_min?: number | null;
}

/** Legacy walk block — pre-dates the `steady`/`mobility` split. */
export interface WalkBlocks extends BlocksBase {
  type: "walk";
  duration_min: number;
  intensity?: string | null;
}

export type Blocks =
  | CircuitBlocks
  | IntervalsBlocks
  | SteadyBlocks
  | MobilityBlocks
  | WalkBlocks;

/** Compile-time exhaustiveness helper — any new Blocks variant that isn't
 * handled in a switch will hit this and fail to type-check. */
export function assertNeverBlock(b: never): never {
  throw new Error(`Unhandled blocks.type: ${(b as { type?: string }).type}`);
}

export interface Plan {
  plan_id: number;
  plan_date: string;
  phase: number;
  week_num: number;
  session_type: SessionType;
  target_rpe: number;
  est_duration_min: number;
  is_skipped: boolean;
  blocks: Blocks;
}

export interface NoPlanResponse {
  error: "no_plan";
  fallback: string;
}

export type IntervalKind =
  | "warmup"
  | "work"
  | "rest"
  | "round_break"
  | "cooldown";

export interface Interval {
  kind: IntervalKind;
  name: string;
  duration_sec: number;
  description?: string;
  reps?: number;
  load_lbs?: number;
  round?: number;
  total_rounds?: number;
}

// ---------------------------------------------------------------------------
// /api/health/status payload
// ---------------------------------------------------------------------------

export interface DayStripEntry {
  plan_date: string;
  session_type: SessionType | null;
  is_skipped: boolean;
  is_logged: boolean;
  is_today: boolean;
  phase: number | null;
  week_num: number | null;
}

export interface ExerciseLog {
  log_type: "strength_set" | "cardio_block";
  exercise: string | null;
  set_num: number | null;
  reps_done: number | null;
  weight_lbs: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe_actual: number | null;
  notes: string | null;
}

export interface LoggedSession {
  plan_id: number;
  plan_date: string;
  session_type: SessionType;
  phase: number;
  week_num: number;
  rpe_actual: number | null;
  logged_at: string;
  notes: string | null;
  exercises: ExerciseLog[];
}

export interface Banner {
  phase: number;
  week_num: number;
  phase_name: string | null;
  as_of_date: string;
}

export interface TodaySummary {
  plan_id: number | null;
  session_type: SessionType | null;
  is_skipped: boolean;
  is_logged: boolean;
  exists: boolean;
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface StatusResponse {
  today: string;
  window_start: string;
  window_end: string;
  today_summary: TodaySummary;
  banner: Banner | null;
  day_strip: DayStripEntry[];
  most_recent_session: LoggedSession | null;
  same_type_history: LoggedSession[];
  rpe_trend: TrendPoint[];
  weight_trend: TrendPoint[];
}

// ---------------------------------------------------------------------------
// POST /api/health/log — write path
// ---------------------------------------------------------------------------

export type LogType = "strength_set" | "cardio_block" | "session_summary";

export interface LogSetIn {
  set_num?: number | null;
  reps_done?: number | null;
  weight_lbs?: number | null;
  rpe_actual?: number | null;
  duration_sec?: number | null;
  distance_m?: number | null;
  hr_avg?: number | null;
  hr_peak?: number | null;
  is_skipped?: boolean;
  notes?: string | null;
}

export interface LogExerciseIn {
  plan_id?: number | null;
  exercise?: string | null;
  log_type: LogType;
  sets: LogSetIn[];
  notes?: string | null;
  /** When set, the Lambda also INSERTs one session_summary row carrying
   * this RPE in the same transaction. Used by Finish-workout to make
   * the last log + summary a single round-trip. */
  session_rpe?: number | null;
}

export interface LogRowOut {
  log_id: number;
  plan_id: number | null;
  log_type: LogType;
  exercise: string | null;
  set_num: number | null;
  reps_done: number | null;
  weight_lbs: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe_actual: number | null;
  notes: string | null;
  is_skipped: boolean;
  logged_at: string;
  logged_via: string;
}

export interface LogResponse {
  plan_id: number | null;
  inserted: number;
  rows: LogRowOut[];
}

// ---------------------------------------------------------------------------
// GET /api/health/today/logged — completion state for the UI
// ---------------------------------------------------------------------------

export interface LoggedExerciseEntry {
  exercise: string;
  log_type: "strength_set" | "cardio_block";
  set_count: number;
}

export interface LoggedTodayResponse {
  plan_id: number | null;
  exercises: LoggedExerciseEntry[];
  has_session_summary: boolean;
}

export interface LastLoggedEntry {
  exercise: string;
  plan_date: string | null;
  weight_lbs: number | null;
  reps_done: number | null;
  rpe_actual: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  /** Per-set notes of that row (carries `setting=<n>`). Absent on older API builds. */
  notes?: string | null;
}

export interface LastLoggedResponse {
  by_exercise: Record<string, LastLoggedEntry>;
}

// ---------------------------------------------------------------------------
// GET /api/health/sessions — per-day plan + per-set rows + aggregates
// ---------------------------------------------------------------------------

export interface SessionSetRow {
  log_id: number;
  log_type: "strength_set" | "cardio_block";
  exercise: string | null;
  set_num: number | null;
  reps_done: number | null;
  weight_lbs: number | null;
  duration_sec: number | null;
  distance_m: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  rpe_actual: number | null;
  notes: string | null;
  is_skipped: boolean;
  logged_at: string;
  logged_via: string;
}

export interface SessionSummaryRow {
  rpe_actual: number | null;
  notes: string | null;
  logged_at: string;
}

export interface OutlierFlags {
  high_rpe_sets: Array<{ exercise: string | null; set_num: number | null; rpe_actual: number }>;
  incomplete: boolean;
  incomplete_logged: number;
  incomplete_planned: number;
  pain_notes: string[];
}

export interface SessionDayRow {
  plan_date: string;
  plan_id: number | null;
  session_type: SessionType | null;
  display_name: string | null;
  phase: number | null;
  week_num: number | null;
  target_rpe: number | null;
  target_hr_zone: number | null;
  is_skipped: boolean;
  is_today: boolean;
  planned_set_count: number;
  logged_set_count: number;
  sets: SessionSetRow[];
  session_summary: SessionSummaryRow | null;
  avg_set_rpe: number | null;
  hr_avg: number | null;
  hr_peak: number | null;
  total_work_sec: number;
  outliers: OutlierFlags;
}

export interface SessionsResponse {
  today: string;
  window_start: string;
  window_end: string;
  days: SessionDayRow[];
}
