export type SessionType =
  | "strength_a"
  | "strength_b"
  | "strength_c"
  | "cardio_intervals"
  | "cardio_z2"
  | "walk"
  | "rest_mobility";

export type ExerciseFormat = "reps" | "duration";

export interface CircuitExercise {
  name: string;
  format: ExerciseFormat;
  target_reps?: number;
  target_load_lbs?: number;
  duration_sec?: number;
  rest_after_sec: number;
}

export interface CircuitBlocks {
  type: "circuit";
  warmup?: string;
  rounds: number;
  rest_between_rounds_sec: number;
  exercises: CircuitExercise[];
  cooldown?: string;
  equipment?: string[];
  setup_notes?: string[];
}

export interface IntervalsTemplate {
  work_sec: number;
  work_settings?: string;
  rest_sec: number;
  rest_settings?: string;
}

export interface IntervalsBlocks {
  type: "intervals";
  warmup_sec: number;
  warmup_settings?: string;
  intervals_template: IntervalsTemplate;
  rounds: number;
  cooldown_sec: number;
  cooldown_settings?: string;
  equipment?: string[];
  setup_notes?: string[];
}

export interface WalkBlocks {
  type: "walk";
  duration_min: number;
  intensity?: string;
  equipment?: string[];
  setup_notes?: string[];
}

export type Blocks = CircuitBlocks | IntervalsBlocks | WalkBlocks;

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
