import type { LogExerciseIn, Plan } from "./types";

/** ROW-LADDER replaces ROW-BUILD (#269) on the planned rower cardio days: a
 * cardio row whose machine is the rower and which is NOT running gate-passed
 * Zone 4 intervals. Those keep the interval screen -- the gate's call, same
 * rule #269 had. Skipped days never qualify. */
export function isPlannedRowLadder(plan: Plan | null | undefined): boolean {
  return plannedRowKind(plan) === "ladder";
}

/** ROW-SCHEDULE: which row screen a planned day opens, or null for none.
 * `blocks.row_kind` decides when the row carries it (every MSP morning from
 * 2026-10-20); an older rower cardio day without it runs as the ladder. */
export function plannedRowKind(plan: Plan | null | undefined): RcKind | null {
  if (!plan || plan.is_skipped) return null;
  const b = plan.blocks;
  if (b.type !== "steady" && b.type !== "intervals") return null;
  if (b.cardio?.modality !== "row") return null;
  if (b.row_kind === "ladder" || b.row_kind === "circuit") return b.row_kind;
  return b.type === "steady" || b.ran_as !== "intervals" ? "ladder" : null;
}

// ---------------------------------------------------------------------------
// ROW-CIRCUIT (Ryan, 2026-10-19) — rower intervals with floor work between.
//
//   round:  row at a stroke rate → 1 min easy (or stopped) → off the rower →
//           push-ups → two core moves → RECORD → back on the rower
//   end:    3 min easy row
//
// The prescription (which rates, how long) comes from the Lambda, computed in
// Python from what he last logged. This file only turns it into a timeline and
// runs it. Everything here is pure so it can be driven by fake timers.
//
// The record card is the ONE place the clock waits for him: once per round,
// prefilled, one tap if nothing changed. Every other item advances on time.
//
// Every item stamps its own wall-clock window. That is what per-exercise heart
// rate is computed over afterwards, so nothing has to stop after each exercise
// and nothing depends on the watch's segment button.
// ---------------------------------------------------------------------------

export type Lever = "rate" | "time" | "repeat";
export type RestMode = "easy" | "stopped";
export type StationFormat = "reps" | "hold";

export interface RcRound {
  round: number;
  work_sec: number;
  spm: number;
}

export interface RcOption {
  lever: Lever;
  ok: boolean;
  reason: string | null;
  rounds: RcRound[];
  row_sec: number;
  label: string;
}

export interface RcStation {
  name: string;
  format: StationFormat;
  duration_sec: number;
  cue: string;
}

/** ROW-LADDER: the rower-only climb — same progression, no floor work, one
 * record card at the end. Each kind has its own history (artemis
 * knowledge/row_circuit.py KINDS), keyed by `row_exercise`. */
/** QUICK-START (2026-10-20): `ride` (Richfield, the bike) and `run` (Brown
 * Deer, the treadmill) are the same ladder climbing a HEART-RATE target. The
 * round value is still carried as `spm`; `unit` says what it is. */
export type RcKind = "circuit" | "ladder" | "ride" | "run";
export type RcUnit = "spm" | "bpm";

/** Words for the machine, by kind. */
export const VERB: Record<RcKind, { act: string; machine: string; on: string }> = {
  circuit: { act: "Row", machine: "rower", on: "on the rower" },
  ladder: { act: "Row", machine: "rower", on: "on the rower" },
  ride: { act: "Ride", machine: "bike", on: "on the bike" },
  run: { act: "Run", machine: "treadmill", on: "on the treadmill" },
};

export interface RcPrescription {
  available: true;
  kind: RcKind;
  session_type: string;
  display_name: string;
  /** "spm" for the row, "bpm" for ride and run. Absent from an older Lambda = spm. */
  unit?: RcUnit;
  step?: number;
  value_min?: number;
  value_max?: number;
  modality?: string;
  device?: string;
  /** The exercise name its Row blocks are logged under — the history key. */
  row_exercise: string;
  rounds: number;
  min_rounds: number;
  max_rounds: number;
  base: RcRound[];
  has_history: boolean;
  last_rounds: number;
  options: Record<Lever, RcOption>;
  default: Lever;
  why: string;
  rest: { sec: number; rate: number };
  timing: {
    station_sec: number;
    off_rower_sec: number;
    between_moves_sec: number;
    back_on_rower_sec: number;
    cooldown_sec: number;
  };
  stations: RcStation[][];
  /** ROW-DNF: last session's rounds that weren't finished at their target.
   * Non-empty = both levers are off and today repeats. */
  unfinished?: RcRound[];
  /** Rounds past last time's count (1-based): continued, not repeated. */
  extrapolated?: number[];
  /** Says which rounds are new; null when none are. */
  extrapolated_note?: string | null;
  /** The time lever's step and name ("+0:15 each round"). Older servers omit
   * both; the screen then falls back to the old minute. */
  time_step_sec?: number;
  time_label?: string;
  /** {round: {move: reps}} from the last session, for prefilling. */
  last_reps: Record<string, Record<string, number>>;
}

export type RcPrescriptionResponse = RcPrescription | { available: false; reason: string };

export type RcItemKind = "get_set" | "row" | "rest" | "move" | "station" | "record" | "cooldown";

export interface RcItem {
  kind: RcItemKind;
  round: number | null;
  name: string;
  /** Seconds, or null for the record card, which waits for Save. */
  sec: number | null;
  spm: number | null;
  format: StationFormat | null;
  cue: string | null;
  /** Spoken as the item starts. */
  say: string;
}

export const GET_SET_SEC = 10;
export const WARN_SEC = 5;

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function minutesWords(sec: number): string {
  if (sec % 60 === 0) return `${sec / 60} minute${sec === 60 ? "" : "s"}`;
  return `${Math.floor(sec / 60)} minutes ${sec % 60} seconds`;
}

export function buildTimeline(rx: RcPrescription, lever: Lever, restMode: RestMode): RcItem[] {
  const rounds = rx.options[lever].rounds;
  const t = rx.timing;
  const items: RcItem[] = [];
  const push = (it: Omit<RcItem, "spm" | "format" | "cue"> & Partial<RcItem>) =>
    items.push({ spm: null, format: null, cue: null, ...it } as RcItem);

  const v = VERB[rx.kind] ?? VERB.ladder;
  const hr = unitOf(rx) === "bpm";
  // A heart-rate ladder's easy minute has no number to hold: "easy" is the
  // instruction. The row's easy minute is a stroke rate.
  const easyName = hr ? "Easy" : `Easy at ${rx.rest.rate}`;
  const easySay = hr ? "Easy." : `Easy. ${rx.rest.rate}.`;
  const at = (x: number) => (hr ? `${x} bpm` : `${x}`);
  rounds.forEach((r, i) => {
    const n = r.round;
    if (i === 0) {
      push({ kind: "get_set", round: n, name: `Get ${v.on}`, sec: GET_SET_SEC,
             say: `Round 1. ${v.act} at ${at(r.spm)} for ${minutesWords(r.work_sec)}.` });
    } else {
      push({ kind: "move", round: n, name: `Back ${v.on}`, sec: t.back_on_rower_sec,
             say: `Round ${n}. Back ${v.on}. ${at(r.spm)} for ${minutesWords(r.work_sec)}.` });
    }
    push({ kind: "row", round: n, name: `${v.act} at ${at(r.spm)}`, sec: r.work_sec, spm: r.spm,
           cue: hr ? "Build into it. Hold the number on your watch." : "Strong drive, easy recovery.",
           say: `${v.act}. ${at(r.spm)}.` });
    const easy = restMode === "easy";
    push({ kind: "rest", round: n, name: easy ? easyName : "Stop — rest",
           sec: rx.rest.sec, spm: easy && !hr ? rx.rest.rate : null,
           say: easy ? easySay : "Stop. Rest." });
    // The ladder has no floor work and no per-round card: rows and rest
    // minutes only, then one card at the end.
    const stations = rx.stations[i] ?? [];
    if (stations.length === 0) return;
    stations.forEach((s, k) => {
      push({ kind: "move", round: n, sec: k === 0 ? t.off_rower_sec : t.between_moves_sec,
             name: k === 0 ? `Off the rower — ${s.name}` : `Next: ${s.name}`,
             say: k === 0 ? `Off the rower. ${s.name} next.` : `${s.name} next.` });
      push({ kind: "station", round: n, name: s.name, sec: s.duration_sec, format: s.format,
             cue: s.cue, say: s.name });
    });
    push({ kind: "record", round: n, name: `Record round ${n}`, sec: null,
           say: `Record round ${n}.` });
  });
  const floor = rx.stations.some((st) => st.length > 0);
  if (floor) {
    push({ kind: "move", round: null, name: "Back on the rower — cool-down", sec: t.back_on_rower_sec,
           say: "Back on the rower for the cool-down." });
  }
  push({ kind: "cooldown", round: null, name: hr ? "Cool-down — easy" : `Cool-down at ${rx.rest.rate}`,
         sec: t.cooldown_sec, spm: hr ? null : rx.rest.rate,
         say: `${easySay} ${minutesWords(t.cooldown_sec)}.` });
  if (!floor) {
    // round null = the FINAL card: every round's rate on one screen.
    push({ kind: "record", round: null, name: "Record the session", sec: null,
           say: "Done. Record the session." });
  }
  return items;
}

/** Planned seconds, the record cards excluded (they take as long as they take). */
export function plannedSec(items: RcItem[]): number {
  return items.reduce((a, i) => a + (i.sec ?? 0), 0);
}

export function summaryLine(opt: RcOption): string {
  const rates = opt.rounds.map((r) => r.spm).join("/");
  const lens = [...new Set(opt.rounds.map((r) => r.work_sec))];
  const len = lens.length === 1 ? clock(lens[0]) : opt.rounds.map((r) => clock(r.work_sec)).join("/");
  return `${rates} spm · ${len}`;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RcWindow {
  /** Epoch ms. */
  start: number;
  end: number | null;
  /** ms actually run (paused time excluded). */
  activeMs: number;
  /** ROW-DNF: activeMs at the first pause during this item — "how long he
   * held it" when he stopped for a break. Null = never paused. */
  breakAtMs?: number | null;
  /** ROW-DNF: ended by Skip or End early before its time was up. */
  cut?: boolean;
}

export interface RcState {
  index: number;
  stageMs: number;
  elapsedMs: number;
  paused: boolean;
  done: boolean;
  warned: boolean;
  windows: RcWindow[];
}

export type RcEvent =
  | { type: "start"; index: number }
  | { type: "warn"; index: number }
  | { type: "done" };

export function initialState(startEpoch: number): RcState {
  return { index: 0, stageMs: 0, elapsedMs: 0, paused: false, done: false, warned: false,
           windows: [{ start: startEpoch, end: null, activeMs: 0 }] };
}

function advance(items: RcItem[], s: RcState, atEpoch: number, events: RcEvent[]): void {
  s.windows[s.index] = { ...s.windows[s.index], end: atEpoch };
  if (s.index + 1 >= items.length) {
    s.done = true;
    events.push({ type: "done" });
    return;
  }
  s.index += 1;
  s.stageMs = 0;
  s.warned = false;
  s.windows[s.index] = { start: atEpoch, end: null, activeMs: 0 };
  events.push({ type: "start", index: s.index });
}

/** Advance by dtMs, ending at `nowEpoch`. A record card never advances here. */
export function tick(items: RcItem[], state: RcState, dtMs: number, nowEpoch: number): { state: RcState; events: RcEvent[] } {
  if (state.paused || state.done || dtMs <= 0) return { state, events: [] };
  const s: RcState = { ...state, windows: [...state.windows] };
  const events: RcEvent[] = [];
  let left = dtMs;
  while (!s.done && left > 0) {
    const it = items[s.index];
    const w = s.windows[s.index];
    if (it.sec == null) {
      // Record card: time runs, the item does not end.
      s.stageMs += left;
      s.elapsedMs += left;
      s.windows[s.index] = { ...w, activeMs: w.activeMs + left };
      left = 0;
      break;
    }
    const dur = it.sec * 1000;
    const step = Math.min(left, dur - s.stageMs);
    s.stageMs += step;
    s.elapsedMs += step;
    s.windows[s.index] = { ...w, activeMs: w.activeMs + step };
    left -= step;
    const warnAt = dur - WARN_SEC * 1000;
    if (!s.warned && (it.kind === "row" || it.kind === "station") && warnAt > 0 && s.stageMs >= warnAt) {
      s.warned = true;
      events.push({ type: "warn", index: s.index });
    }
    if (s.stageMs >= dur) advance(items, s, nowEpoch - left, events);
  }
  return { state: s, events };
}

/** The record card was saved: end it and move on. */
export function saveRecord(items: RcItem[], state: RcState, nowEpoch: number): { state: RcState; events: RcEvent[] } {
  if (state.done || items[state.index].kind !== "record") return { state, events: [] };
  const s: RcState = { ...state, windows: [...state.windows] };
  const events: RcEvent[] = [];
  advance(items, s, nowEpoch, events);
  return { state: s, events };
}

/** ROW-LADDER "End early": close the current item and go straight to the
 * final record card, so the rounds already rowed are recorded rather than
 * lost. A no-op when there is no final card (the circuit records per round). */
export function jumpToFinal(items: RcItem[], state: RcState, nowEpoch: number): { state: RcState; events: RcEvent[] } {
  const target = items.findIndex((i, k) => k > state.index && i.kind === "record" && i.round == null);
  if (state.done || target < 0) return { state, events: [] };
  const s: RcState = { ...state, windows: [...state.windows] };
  markCut(items, s);
  s.windows[s.index] = { ...s.windows[s.index], end: nowEpoch };
  s.index = target;
  s.stageMs = 0;
  s.warned = false;
  s.windows[target] = { start: nowEpoch, end: null, activeMs: 0 };
  return { state: s, events: [{ type: "start", index: target }] };
}

/** Rounds whose row actually started and ended — what a final card can record. */
/** ROW-DNF: pause or resume. Pausing during a row records how far in he was
 * the first time, which is what "held 60-75 s" means on the card. */
export function togglePause(items: RcItem[], state: RcState): RcState {
  if (state.done) return state;
  const s: RcState = { ...state, windows: [...state.windows], paused: !state.paused };
  const w = s.windows[s.index];
  if (s.paused && items[s.index].kind === "row" && w && w.breakAtMs == null) {
    s.windows[s.index] = { ...w, breakAtMs: w.activeMs };
  }
  return s;
}

/** A row ended before its time by Skip or End early. */
function markCut(items: RcItem[], s: RcState): void {
  const it = items[s.index];
  if (it.kind === "row" && it.sec != null && s.stageMs < it.sec * 1000) {
    s.windows[s.index] = { ...s.windows[s.index], cut: true };
  }
}

/** ROW-DNF prefill for a round's card: a row he paused in, or cut short, was
 * probably not finished. He confirms or clears it — the app only suggests. */
export function suggestDnf(items: RcItem[], state: RcState, round: number): { dnf: boolean; heldSec: number | null } {
  const i = items.findIndex((it) => it.kind === "row" && it.round === round);
  const w = i >= 0 ? state.windows[i] : undefined;
  if (!w) return { dnf: false, heldSec: null };
  const broke = w.breakAtMs != null;
  if (!broke && !w.cut) return { dnf: false, heldSec: null };
  return { dnf: true, heldSec: Math.round((broke ? w.breakAtMs! : w.activeMs) / 1000) };
}

export function rowedRounds(items: RcItem[], state: RcState): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    const w = state.windows[i];
    if (it.kind === "row" && it.round != null && w?.end != null) out.push(it.round);
  });
  return out;
}

/** Skip forward to the next item. Never past a record card: a round is not
 * over until it is recorded, and skipping it would lose the round's numbers. */
export function skip(items: RcItem[], state: RcState, nowEpoch: number): { state: RcState; events: RcEvent[] } {
  if (state.done || items[state.index].kind === "record") return { state, events: [] };
  const s: RcState = { ...state, windows: [...state.windows] };
  const events: RcEvent[] = [];
  markCut(items, s);
  advance(items, s, nowEpoch, events);
  return { state: s, events };
}

export function remainingSec(items: RcItem[], state: RcState): number | null {
  if (state.done) return 0;
  const it = items[state.index];
  if (it.sec == null) return null;
  return Math.max(0, Math.ceil((it.sec * 1000 - state.stageMs) / 1000));
}

/** The next item that isn't a transition, for the "Next" strip. */
export function nextUp(items: RcItem[], index: number): RcItem | null {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].kind !== "move") return items[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Logging — one round's rows, built from its windows and the record card.
// ---------------------------------------------------------------------------

export interface RecordEntry {
  /** Strokes/min held. Prefilled with the target. */
  spm: number;
  /** The rower monitor's running total at the end of this round, if read. */
  metersTotal: number | null;
  /** Reps per `reps` station, by name. */
  reps: Record<string, number | null>;
  /** ROW-DNF: he did not finish the row at its target. Blocks advancing. */
  dnf?: boolean;
  /** How long he held the target before stopping, when he knows. */
  heldSec?: number | null;
}

function iso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** Round meters from the running total: this reading less the last one. A
 * reading below the previous one means the monitor was reset or misread —
 * no distance rather than a negative one. */
export function roundMeters(total: number | null, previousTotal: number | null): number | null {
  if (total == null) return null;
  const prev = previousTotal ?? 0;
  return total >= prev ? total - prev : null;
}

/** Who a log belongs to: the day's planned row when launched from Today
 * (`planId`), else an ad-hoc session of this kind. Never both — the Lambda
 * refuses that. */
export interface LogOwner {
  sessionType: string;
  rowExercise: string;
  planId: number | null;
  unit?: RcUnit;
  modality?: string;
  device?: string;
}

export function unitOf(rx: RcPrescription): RcUnit {
  return rx.unit === "bpm" ? "bpm" : "spm";
}

export function ownerOf(rx: RcPrescription, planId: number | null = null): LogOwner {
  return { sessionType: rx.session_type, rowExercise: rx.row_exercise, planId,
           unit: unitOf(rx), modality: rx.modality ?? "row", device: rx.device ?? "water" };
}

function ownerFields(o: LogOwner): Pick<LogExerciseIn, "plan_id" | "adhoc_session_type"> {
  return o.planId != null
    ? { plan_id: o.planId, adhoc_session_type: null }
    : { plan_id: null, adhoc_session_type: o.sessionType };
}

export function roundLogs(
  items: RcItem[],
  state: RcState,
  round: number,
  entry: RecordEntry,
  meters: number | null,
  target: RcRound,
  owner: LogOwner,
): LogExerciseIn[] {
  const out: LogExerciseIn[] = [];
  items.forEach((it, i) => {
    if (it.round !== round) return;
    const w = state.windows[i];
    if (!w || w.end == null) return;
    const base = ownerFields(owner);
    if (it.kind === "row") {
      out.push({
        ...base,
        exercise: owner.rowExercise,
        log_type: "cardio_block",
        modality: owner.modality ?? "row",
        device: owner.device ?? "water",
        sets: [{
          set_num: round,
          duration_sec: Math.round(w.activeMs / 1000),
          distance_m: meters,
          // QUICK-START: a heart-rate ladder's held value is hr_avg and its
          // target target_bpm (artemis 057); the stroke-rate columns stay empty.
          ...(owner.unit === "bpm"
            ? { hr_avg: entry.spm, target_bpm: target.spm, stroke_rate: null, target_spm: null }
            : { stroke_rate: entry.spm, target_spm: target.spm }),
          started_at: iso(w.start),
          ended_at: iso(w.end),
          target_sec: target.work_sec,
          dnf: !!entry.dnf,
          notes: `${owner.sessionType} target ${target.spm} ${owner.unit ?? "spm"} ${clock(target.work_sec)}` +
                 (entry.dnf ? ` · DNF${entry.heldSec != null ? `, held ${entry.heldSec} s` : ""}` : "") +
                 (meters != null ? " · meters include the rest minute" : ""),
        }],
      });
    } else if (it.kind === "station") {
      const reps = it.format === "reps" ? (entry.reps[it.name] ?? null) : null;
      out.push({
        ...base,
        exercise: it.name,
        log_type: "strength_set",
        sets: [{
          set_num: round,
          reps_done: reps,
          duration_sec: Math.round(w.activeMs / 1000),
          started_at: iso(w.start),
          ended_at: iso(w.end),
        }],
      });
    }
  });
  return out;
}

export function summaryLog(
  state: RcState, rounds: number, lever: Lever, recorded: number, owner: LogOwner,
  totalMeters: number | null = null,
): LogExerciseIn {
  const min = Math.floor(state.elapsedMs / 60000);
  return {
    ...ownerFields(owner),
    exercise: null,
    log_type: "session_summary",
    sets: [{
      duration_sec: Math.round(state.elapsedMs / 1000),
      distance_m: totalMeters,
      started_at: iso(state.windows[0]?.start),
      ended_at: iso(state.windows[state.index]?.end ?? null),
      notes: `${owner.sessionType}: ${state.done ? "complete" : "partial"} ${min} min · ` +
             `${recorded} of ${rounds} rounds recorded · ${lever}`,
      is_skipped: false,
    }],
  };
}

/** Prefill for a reps station: last session's same round, else this session's
 * previous round of the same move, else nothing. */
export function prefillReps(
  rx: RcPrescription, round: number, name: string,
  thisSession: Record<number, Record<string, number | null>>,
): number | null {
  const last = rx.last_reps?.[String(round)]?.[name];
  if (typeof last === "number") return last;
  for (let r = round - 1; r >= 1; r--) {
    const v = thisSession[r]?.[name];
    if (typeof v === "number") return v;
  }
  return null;
}
