import type { EquipmentClass } from "./equipment";

export type { EquipmentClass };

export type SessionType =
  | "strength_a"
  | "strength_b"
  | "strength_c"
  | "cardio_intervals"
  | "cardio_z2"
  | "walk"
  | "rest_mobility"
  | "recovery_flow";

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
  // ── Check-in adjustment (Artemis FRIDAY-1) ──
  /** Sets for THIS exercise when it differs from the circuit's rounds. */
  sets?: number | null;
  /** Per-exercise RPE ceiling. */
  rpe_cap?: number | null;
  /** Use this percent of the usual load (80 = −20%). Legacy (FRIDAY-1). */
  load_pct?: number | null;
  /** PAIN-1: the last logged load a lighter target_load_lbs was taken from. */
  load_from?: number | null;
  /** PAIN-1: "go lighter than last time" when there was no load to lighten. */
  load_note?: string | null;
  /** "checkin" when a substitution put it here. */
  added_by?: string | null;
  /** The exercise it replaced. */
  replaces?: string | null;
}

/** blocks.adjustment — written by Artemis when a morning check-in changed the plan. */
export interface PlanAdjustment {
  reason?: string | null;
  rules_fired?: string[] | null;
  checkin_id?: string | null;
  at?: string | null;
  removed?: string[] | null;
  added?: string[] | null;
  eased?: string[] | null;
  summary?: string[] | null;
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
  /** Present when today's plan was adjusted by a check-in. */
  adjustment?: PlanAdjustment | null;
  /** The plan as written (blocks + row fields) before the adjustment. */
  original?: unknown;
  /** Session-wide RPE ceiling after a recovery adjustment. */
  rpe_cap?: number | null;
  /** Mobility added by an adjustment. */
  mobility_focus?: string[] | null;
  mobility_min?: number | null;
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

/** One timed hold in a Recovery Flow (YOGA-1). */
export interface FlowStep {
  /** Table number: "1".."16", "11a", "11b"… */
  step: string;
  name: string;
  side: "R" | "L" | null;
  /** "Right leg forward", "Lean left"… */
  side_label?: string | null;
  duration_sec: number;
  /** R and L entries of one group must hold equally long. */
  mirror_group: string | null;
  cue?: string | null;
  /** Easier option, e.g. "Dolphin — forearms down". */
  easier?: string | null;
}

export interface FlowHold {
  name: string;
  side?: null;
  duration_sec: number;
  cue?: string | null;
}

/** Guided, hands-free mobility flow (YOGA-1). */
export interface RecoveryFlowBlocks extends BlocksBase {
  type: "recovery_flow";
  location?: string | null;
  rounds: number;
  /** Round whose holds double, and the step-number range that doubles. */
  double_round?: number | null;
  double_steps?: [number, number] | null;
  preview_sec?: number | null;
  /** Timed blocks before round 1 (office: Stretch Trainer). */
  pre?: FlowHold[] | null;
  flow: FlowStep[];
  close?: FlowHold | null;
  total_sec?: number | null;
  notes?: string | null;
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
  | WalkBlocks
  | RecoveryFlowBlocks;

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

// ── GD-WEEK: GET /api/health/plan ───────────────────────────────────────────

export type PlanDayStatus = "done" | "partial" | "missed" | "upcoming" | "today";

export interface LoggedExerciseSummary {
  exercise: string;
  log_type: string;
  sets: number;
  reps: Array<number | null>;
  top_weight_lbs: number | null;
  duration_sec: number | null;
  skipped: number;
}

export interface PlanDay {
  plan_id: number;
  plan_date: string;
  session_type: SessionType;
  display_name: string | null;
  phase: number;
  week_num: number;
  target_rpe: number | null;
  est_duration_min: number | null;
  location: string | null;
  is_skipped: boolean;
  adjusted: boolean;
  status: PlanDayStatus;
  blocks: Blocks;
  logged: LoggedExerciseSummary[];
  summary_notes: string | null;
}

export interface PlanRangeResponse {
  today: string;
  timezone: string;
  range_from: string;
  range_to: string;
  days: PlanDay[];
}

// ── STATUS-1: GET /api/health/overview ──────────────────────────────────────

export interface ProgramInfo {
  name: string | null;
  phase: number;
  week: number;
  weeks_total: number;
  anchor: string;
  deload_week: number | null;
  weeks_to_deload: number | null;
  week_start: string;
  week_end: string;
  sessions_done: number;
  sessions_planned: number;
  source: "state" | "derived";
}

export interface ProgressInfo {
  unit: "sets" | "minutes" | "rest";
  done: number | null;
  planned: number | null;
}

export interface CheckinInfo {
  date: string;
  sleep_hrs: number | null;
  energy: number | null;
  weight_lbs: number | null;
  resting_hr: number | null;
  soreness: Record<string, number>;
  pain: Record<string, number>;
}

export interface TodayOverview {
  date: string;
  day: PlanDay | null;
  progress: ProgressInfo | null;
  checkin: CheckinInfo | null;
  adjustment: { summary: string[]; rules_fired: string[] } | null;
}

export interface TopSetInfo {
  date: string;
  weight_lbs: number | null;
  reps: number | null;
  score: number;
}

export interface StrengthProgressRow {
  exercise: string;
  sessions: number;
  last: TopSetInfo | null;
  previous: TopSetInfo | null;
  best: TopSetInfo | null;
  trend: "up" | "flat" | "down" | null;
  /** Legacy single setting (before named positions). */
  setting: number | null;
  /** Named machine positions from the latest set: {seat, pad, range}. */
  setup?: Record<string, number> | null;
}

export interface PatternInfo {
  id: number;
  exercise: string;
  region: string;
  hits: number;
  exposures: number;
  text: string;
  last_reflection_at: string | null;
}

export interface FlagInfo {
  date: string;
  kind: "missed" | "partial" | "rpe" | "pain" | string;
  text: string;
}

export interface OverviewResponse {
  date: string;
  timezone: string;
  program: ProgramInfo | null;
  week_days: PlanDay[];
  today: TodayOverview;
  strength_progress: StrengthProgressRow[];
  checkins_14d: CheckinInfo[];
  patterns: PatternInfo[];
  flags: FlagInfo[];
  weight_30d: TrendPoint[];
  weight_summary: { first: TrendPoint; latest: TrendPoint; change: number } | null;
  previous_program_end: string | null;
}
