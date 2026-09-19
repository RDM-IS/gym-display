import type { FlowHold, FlowStep, RecoveryFlowBlocks } from "./types";

// ---------------------------------------------------------------------------
// Recovery Flow (YOGA-1, timing YOGA-3) — a hands-free timeline.
//
//   pre (seated meditation; office: + Stretch Trainer 8 min)
//   round 1: every flow step
//   round 2: every flow step, holds doubled on steps 10–16
//   close: savasana
//
// Every item is a TRANSITION ("Move into position", 3 s or 5 s by the change
// in body position) followed by its HOLD. The next item is announced
// `leadin_sec` before a hold ends. Everything here is pure so the engine can
// be driven by fake timers.
// ---------------------------------------------------------------------------

export type FlowItemKind = "pre" | "pose" | "close";

export const POSTURES = ["standing", "kneeling", "quadruped", "prone", "supine", "seated"] as const;
export type Posture = (typeof POSTURES)[number];

export const DEFAULT_TRANSITION_SHORT_SEC = 3;
export const DEFAULT_TRANSITION_LONG_SEC = 5;
export const DEFAULT_LEADIN_SEC = 3;
export const DEFAULT_START_POSTURE: Posture = "standing";

export interface FlowItem {
  kind: FlowItemKind;
  /** Pose / block name. */
  name: string;
  /** Name + side, for lists and the Next strip ("High lunge · Right leg forward"). */
  title: string;
  side: "R" | "L" | null;
  sideLabel: string | null;
  cue: string | null;
  easier: string | null;
  duration_sec: number;
  /** 1-based round for poses; null for pre / close. */
  round: number | null;
  totalRounds: number;
  /** Table step ("11a") for poses. */
  step: string | null;
  mirrorGroup: string | null;
  /** The other side of this item's mirror group starts here → its transition
   * is the "Switch sides" screen. */
  switchBefore: boolean;
  /** First pose of a round > 1 → its transition announces the round. */
  roundStart: boolean;
  posture: string | null;
  /** Seconds to move into this item from the one before (the first: from
   * standing at the iPad). */
  transitionSec: number;
  /** Spoken `leadin_sec` before the previous hold ends (or at Start). */
  leadIn: string;
  /** Spoken as the transition begins: just the pose and side. */
  moveCue: string;
}

export function stepNumber(step: string): number {
  return parseInt(step.replace(/\D/g, ""), 10);
}

/** Hold seconds for every flow step in a round (1-based). */
export function holdsForRound(blocks: RecoveryFlowBlocks, round: number): number[] {
  const [lo, hi] = blocks.double_steps ?? [10, 16];
  const dbl = blocks.double_round ?? 2;
  return blocks.flow.map((s) => {
    const n = stepNumber(s.step);
    return round === dbl && n >= lo && n <= hi ? s.duration_sec * 2 : s.duration_sec;
  });
}

/** Seconds to move between two body positions — mirrors
 * artemis.health_office.transition_sec. Short when nothing changes or it's
 * floor to floor; long when getting up or down (into/out of standing, or
 * supine ↔ seated). An unknown posture gets the long one. */
export function transitionSec(
  prev: string | null | undefined,
  next: string | null | undefined,
  short = DEFAULT_TRANSITION_SHORT_SEC,
  long = DEFAULT_TRANSITION_LONG_SEC,
): number {
  const known = (p: string | null | undefined): p is Posture =>
    !!p && (POSTURES as readonly string[]).includes(p);
  if (!known(prev) || !known(next)) return long;
  if (prev === next) return short;
  if (prev === "standing" || next === "standing") return long;
  if ((prev === "supine" && next === "seated") || (prev === "seated" && next === "supine")) return long;
  return short;
}

/** "60 seconds", "3 minutes", "2 minutes 30 seconds". */
export function durationWords(sec: number): string {
  if (sec < 120) return `${sec} seconds`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m} minutes ${s} seconds` : `${m} minutes`;
}

function sideWords(s: FlowStep): string {
  if (s.side_label) return s.side_label;
  if (s.side === "R") return "Right side";
  if (s.side === "L") return "Left side";
  return "";
}

interface Spoken { spoken: string; side: string | null; duration_sec: number }

/** "High lunge, left leg forward." */
export function moveCueFor(p: Spoken): string {
  return p.side ? `${p.spoken}, ${p.side.toLowerCase()}.` : `${p.spoken}.`;
}

/** The full lead-in for the item about to start. */
export function leadInFor(p: Spoken, how: "first" | "next" | "switch" | "round", round?: number | null): string {
  const name = p.spoken.toLowerCase();
  const pose = p.side ? `${name}, ${p.side.toLowerCase()},` : name;
  const dur = durationWords(p.duration_sec);
  if (how === "first") return `We'll begin with ${pose} for ${dur}.`;
  if (how === "switch") return `Next, ${pose} for ${dur}.`;
  const line = `Next we'll move into ${pose} for ${dur}.`;
  return how === "round" ? `Round ${round}. ${line}` : line;
}

export function buildFlowTimeline(blocks: RecoveryFlowBlocks): FlowItem[] {
  const rounds = Math.max(1, blocks.rounds || 1);
  const items: Omit<FlowItem, "transitionSec" | "leadIn" | "moveCue">[] = [];
  const spokenOf = new Map<number, Spoken>();
  const hold = (kind: "pre" | "close", p: FlowHold) => {
    spokenOf.set(items.length, { spoken: p.name, side: null, duration_sec: p.duration_sec });
    items.push({
      kind, name: p.name, title: p.name, side: null, sideLabel: null,
      cue: p.cue ?? null, easier: null, duration_sec: p.duration_sec, round: null,
      totalRounds: rounds, step: null, mirrorGroup: null, switchBefore: false,
      roundStart: false, posture: p.posture ?? null,
    });
  };
  for (const p of blocks.pre ?? []) hold("pre", p);
  for (let r = 1; r <= rounds; r++) {
    const holds = holdsForRound(blocks, r);
    // For each mirror group: the side seen first, and whether we've switched.
    const firstSide = new Map<string, "R" | "L">();
    const switched = new Set<string>();
    blocks.flow.forEach((s, i) => {
      let switchBefore = false;
      if (s.mirror_group && s.side) {
        const first = firstSide.get(s.mirror_group);
        if (!first) firstSide.set(s.mirror_group, s.side);
        else if (s.side !== first && !switched.has(s.mirror_group)) {
          switched.add(s.mirror_group);
          switchBefore = true;
        }
      }
      const label = s.side ? sideWords(s) : null;
      spokenOf.set(items.length, { spoken: s.spoken || s.name, side: label, duration_sec: holds[i] });
      items.push({
        kind: "pose", name: s.name, title: label ? `${s.name} · ${label}` : s.name,
        side: s.side, sideLabel: label, cue: s.cue ?? null, easier: s.easier ?? null,
        duration_sec: holds[i], round: r, totalRounds: rounds, step: s.step,
        mirrorGroup: s.mirror_group, switchBefore, roundStart: i === 0 && r > 1,
        posture: s.posture ?? null,
      });
    });
  }
  if (blocks.close) hold("close", blocks.close);

  const short = blocks.transition_short_sec ?? DEFAULT_TRANSITION_SHORT_SEC;
  const long = blocks.transition_long_sec ?? DEFAULT_TRANSITION_LONG_SEC;
  let prev: string | null = blocks.start_posture ?? DEFAULT_START_POSTURE;
  return items.map((it, i) => {
    const sp = spokenOf.get(i)!;
    const how = i === 0 ? "first" : it.switchBefore ? "switch" : it.roundStart ? "round" : "next";
    const out: FlowItem = {
      ...it,
      transitionSec: transitionSec(prev, it.posture, short, long),
      leadIn: leadInFor(sp, how, it.round),
      moveCue: moveCueFor(sp),
    };
    prev = it.posture;
    return out;
  });
}

export function flowTotalSec(blocks: RecoveryFlowBlocks): number {
  return buildFlowTimeline(blocks).reduce((a, i) => a + i.transitionSec + i.duration_sec, 0);
}

/** Side validator — mirrors artemis.health_office.validate_flow. Every mirror
 * group needs R and L entries with equal total hold in every round; a lunge
 * unit compares as a whole group, not pose by pose. [] = valid. */
export function validateFlow(blocks: RecoveryFlowBlocks): string[] {
  const errors: string[] = [];
  if (!blocks.flow?.length) return ["flow has no steps"];
  const groups = new Map<string, number[]>();
  blocks.flow.forEach((s, i) => {
    if (!s.mirror_group) {
      if (s.side) errors.push(`step ${s.step} has a side but no mirror_group`);
      return;
    }
    if (s.side !== "R" && s.side !== "L") {
      errors.push(`step ${s.step} in ${s.mirror_group} needs side R or L`);
      return;
    }
    groups.set(s.mirror_group, [...(groups.get(s.mirror_group) ?? []), i]);
  });
  const rounds = Math.max(1, blocks.rounds || 1);
  for (let r = 1; r <= rounds; r++) {
    const holds = holdsForRound(blocks, r);
    for (const [g, idx] of groups) {
      const sum = { R: 0, L: 0 };
      const seen = new Set<string>();
      for (const i of idx) {
        const side = blocks.flow[i].side as "R" | "L";
        sum[side] += holds[i];
        seen.add(side);
      }
      if (seen.size < 2) {
        const missing = seen.has("R") ? "L" : "R";
        if (r === 1) errors.push(`${g}: missing side ${missing}`);
      } else if (sum.R !== sum.L) {
        errors.push(`${g}: R ${sum.R}s ≠ L ${sum.L}s (round ${r})`);
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Engine — advances on elapsed time only. No input is ever required.
// ---------------------------------------------------------------------------

export type FlowStage = "transition" | "hold";
export type LeadKind = "next" | "switch" | "round";

export type FlowEvent =
  /** Moving into item `index`: speak its move cue, show "Move into position". */
  | { type: "transition"; index: number }
  /** The hold of item `index` starts: start tone, the timer runs. */
  | { type: "hold"; index: number }
  /** `leadin_sec` before the hold ends: announce the next item. */
  | { type: "leadin"; index: number; next: number; kind: LeadKind;
      /** How far past the lead-in point this tick landed — the words wait
       * that much less, so they still start exactly `leadin_sec` out. */
      lateMs: number }
  | { type: "done" };

export interface FlowState {
  index: number;
  stage: FlowStage;
  /** ms spent in the current stage. */
  stageMs: number;
  /** ms actually spent in the flow (paused time excluded). */
  elapsedMs: number;
  paused: boolean;
  done: boolean;
  /** The current hold's lead-in has fired. */
  ledIn: boolean;
}

export function initialFlowState(): FlowState {
  return { index: 0, stage: "transition", stageMs: 0, elapsedMs: 0, paused: false, done: false,
           ledIn: false };
}

/** How long each lead-in tone plays before the words start, so the chime
 * never overlaps the speech and the words begin exactly at `leadin_sec`. */
export const CHIME_LEAD_MS: Record<LeadKind, number> = { next: 700, switch: 850, round: 1100 };

export function leadKind(items: FlowItem[], index: number): LeadKind {
  const next = items[index + 1];
  if (!next) return "next";
  if (next.switchBefore) return "switch";
  if (next.roundStart) return "round";
  return "next";
}

function stageMsOf(items: FlowItem[], s: FlowState): number {
  const it = items[s.index];
  return (s.stage === "transition" ? it.transitionSec : it.duration_sec) * 1000;
}

/** Advance by dtMs. Returns the new state and the events crossed, in order. */
export function tickFlow(
  items: FlowItem[],
  state: FlowState,
  dtMs: number,
  leadinSec = DEFAULT_LEADIN_SEC,
): { state: FlowState; events: FlowEvent[] } {
  if (state.paused || state.done || dtMs <= 0) return { state, events: [] };
  const s = { ...state };
  const events: FlowEvent[] = [];
  let left = dtMs;
  while (!s.done) {
    const dur = stageMsOf(items, s);
    const step = Math.min(left, dur - s.stageMs);
    s.stageMs += step;
    s.elapsedMs += step;
    left -= step;
    if (s.stage === "hold" && !s.ledIn && s.index + 1 < items.length) {
      const kind = leadKind(items, s.index);
      const at = Math.max(0, dur - leadinSec * 1000 - CHIME_LEAD_MS[kind]);
      if (s.stageMs >= at) {
        s.ledIn = true;
        events.push({ type: "leadin", index: s.index, next: s.index + 1, kind,
                      lateMs: s.stageMs - at });
      }
    }
    if (s.stageMs < dur) break;
    if (s.stage === "transition") {
      s.stage = "hold";
      s.stageMs = 0;
      events.push({ type: "hold", index: s.index });
    } else if (s.index + 1 >= items.length) {
      s.done = true;
      events.push({ type: "done" });
    } else {
      s.index += 1;
      s.stage = "transition";
      s.stageMs = 0;
      s.ledIn = false;
      events.push({ type: "transition", index: s.index });
    }
    if (left <= 0 && stageMsOf(items, s) > 0) break;
  }
  return { state: s, events };
}

/** Swipe: jump to the next (or previous) item's transition. Skipped time
 * isn't counted. */
export function skipFlow(items: FlowItem[], state: FlowState, dir: 1 | -1): { state: FlowState; events: FlowEvent[] } {
  if (state.done) return { state, events: [] };
  const target = Math.max(0, state.index + dir);
  if (target >= items.length) return { state: { ...state, done: true }, events: [{ type: "done" }] };
  return { state: { ...state, index: target, stage: "transition", stageMs: 0, ledIn: false },
           events: [{ type: "transition", index: target }] };
}

/** Seconds left in the current stage (the transition countdown, or the hold). */
export function remainingInStageSec(items: FlowItem[], state: FlowState): number {
  if (state.done) return 0;
  return Math.max(0, Math.ceil((stageMsOf(items, state) - state.stageMs) / 1000));
}

export function remainingTotalSec(items: FlowItem[], state: FlowState): number {
  if (state.done) return 0;
  let ms = stageMsOf(items, state) - state.stageMs;
  if (state.stage === "transition") ms += items[state.index].duration_sec * 1000;
  for (let i = state.index + 1; i < items.length; i++) {
    ms += (items[i].transitionSec + items[i].duration_sec) * 1000;
  }
  return Math.max(0, Math.ceil(ms / 1000));
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** session_summary notes for automatic logging. */
export function flowLogNotes(kind: "complete" | "partial", elapsedMs: number, totalSec: number): string {
  const mins = (ms: number) => Math.floor(ms / 60000);
  const total = Math.round(totalSec / 60);
  return kind === "complete"
    ? `recovery_flow: complete ${mins(elapsedMs)} min`
    : `recovery_flow: partial ${mins(elapsedMs)} of ${total} min`;
}
