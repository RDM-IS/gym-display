import type { FlowHold, FlowStep, RecoveryFlowBlocks } from "./types";

// ---------------------------------------------------------------------------
// Recovery Flow (YOGA-1, timing YOGA-3) — a hands-free timeline.
//
//   pre (seated meditation; office: + Stretch Trainer 8 min)
//   round 1: every flow step
//   round 2: every flow step except the ones marked round 1 only (easy pose)
//   close: savasana
//
// Every item is a TRANSITION ("Move into position") followed by its HOLD.
// YOGA-4: the transition length is read from the step (`transition_sec`) —
// the seeded table is the only source and the posture-derived 3 s / 5 s rule
// is gone — every hold is the same in both rounds, and the next item is
// announced `leadin_sec` before a hold ends, with no chime in front of it.
// Everything here is pure so the engine can be driven by fake timers.
// ---------------------------------------------------------------------------

export type FlowItemKind = "pre" | "pose" | "close";

export const POSTURES = ["standing", "kneeling", "quadruped", "prone", "supine", "seated"] as const;
export type Posture = (typeof POSTURES)[number];

/** Used for a plan row seeded before YOGA-4, which has no transition table.
 * Such a row still plays; it just moves on the old short transition. */
export const FALLBACK_TRANSITION_SEC = 3;

/** True when this row predates the YOGA-4 transition table. */
export function legacyTransitions(blocks: RecoveryFlowBlocks): boolean {
  return blocks.flow.some((s) => typeof s.transition_sec !== "number");
}
/** YOGA-4: the lead-in words start 7 s before the hold ends. */
export const DEFAULT_LEADIN_SEC = 7;
/** YOGA-5: the one mid-hold line, this many seconds into the hold. */
export const DEFAULT_CUE_MID_SEC = 12;
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
  /** YOGA-5: the display spelling, shown small under the English name. Null
   * for the pre blocks, which have no meaningful Sanskrit. */
  sanskrit: string | null;
  /** YOGA-5: the one line spoken partway into the hold. Null = say nothing,
   * which is what meditation and savasana get — those two are silent for the
   * whole of their timer (Ryan, 2026-09-20). */
  cueMid: string | null;
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
  /** Seconds to move into this item from the one before, straight from the
   * seeded transition table. */
  transitionSec: number;
  /** Spoken `leadin_sec` before the previous hold ends (or at Start). */
  leadIn: string;
  /** Spoken as the transition begins: just the pose and side. */
  moveCue: string;
}

/** The steps played in `round` — mirrors health_office.flow_steps_for_round.
 * A step may name its rounds (easy pose is round 1 only); most don't. */
export function stepsForRound(blocks: RecoveryFlowBlocks, round: number): FlowStep[] {
  return blocks.flow.filter((s) => !s.rounds?.length || s.rounds.includes(round));
}

/** Hold seconds for every step played in `round`. Since YOGA-4 nothing
 * doubles, so this is just each step's own hold. */
export function holdsForRound(blocks: RecoveryFlowBlocks, round: number): number[] {
  return stepsForRound(blocks, round).map((s) => s.duration_sec);
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

interface Spoken {
  spoken: string;
  side: string | null;
  duration_sec: number;
  /** Phonetic Sanskrit, for the move cue. Null → the cue stays English. */
  sanskritSpoken?: string | null;
}

/** The cue spoken as the transition begins.
 *
 * YOGA-5: Sanskrit, phonetically, with NO side — "Move to Ashta Chandrasana."
 * The 7 s lead-in just gave the side in English and the screen shows it, so
 * repeating it here is noise. Meditation and the Stretch Trainer have no
 * Sanskrit and keep the English cue, with the side if they had one. */
export function moveCueFor(p: Spoken): string {
  if (p.sanskritSpoken) return `Move to ${p.sanskritSpoken}.`;
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
  const transitions: number[] = [];
  const hold = (kind: "pre" | "close", p: FlowHold) => {
    spokenOf.set(items.length, { spoken: p.name, side: null, duration_sec: p.duration_sec,
                                 sanskritSpoken: p.sanskrit_spoken ?? null });
    transitions.push(p.transition_sec ?? FALLBACK_TRANSITION_SEC);
    items.push({
      kind, name: p.name, title: p.name, side: null, sideLabel: null,
      cue: p.cue ?? null, easier: null, sanskrit: p.sanskrit ?? null,
      cueMid: p.cue_mid ?? null,
      duration_sec: p.duration_sec, round: null,
      totalRounds: rounds, step: null, mirrorGroup: null, switchBefore: false,
      roundStart: false, posture: p.posture ?? null,
    });
  };
  for (const p of blocks.pre ?? []) hold("pre", p);
  for (let r = 1; r <= rounds; r++) {
    const steps = stepsForRound(blocks, r);
    // For each mirror group: the side seen first, and whether we've switched.
    const firstSide = new Map<string, "R" | "L">();
    const switched = new Set<string>();
    steps.forEach((s, i) => {
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
      spokenOf.set(items.length, { spoken: s.spoken || s.name, side: label,
                                   duration_sec: s.duration_sec,
                                   sanskritSpoken: s.sanskrit_spoken ?? null });
      transitions.push(s.transition_sec ?? FALLBACK_TRANSITION_SEC);
      items.push({
        kind: "pose", name: s.name, title: label ? `${s.name} · ${label}` : s.name,
        side: s.side, sideLabel: label, cue: s.cue ?? null, easier: s.easier ?? null,
        sanskrit: s.sanskrit ?? null, cueMid: s.cue_mid ?? null,
        duration_sec: s.duration_sec, round: r, totalRounds: rounds, step: s.step,
        mirrorGroup: s.mirror_group, switchBefore, roundStart: i === 0 && r > 1,
        posture: s.posture ?? null,
      });
    });
  }
  if (blocks.close) hold("close", blocks.close);

  return items.map((it, i) => {
    const sp = spokenOf.get(i)!;
    const how = i === 0 ? "first" : it.switchBefore ? "switch" : it.roundStart ? "round" : "next";
    return {
      ...it,
      transitionSec: transitions[i],
      leadIn: leadInFor(sp, how, it.round),
      moveCue: moveCueFor(sp),
    };
  });
}

export function flowTotalSec(blocks: RecoveryFlowBlocks): number {
  return buildFlowTimeline(blocks).reduce((a, i) => a + i.transitionSec + i.duration_sec, 0);
}

/** Side validator — mirrors artemis.health_office.validate_flow. Every mirror
 * group needs R and L entries with equal total hold in every round; a lunge
 * unit compares as a whole group, not pose by pose. [] = valid.
 *
 * Only side errors block the session: they mean the plan would work one side
 * harder than the other, which is worth stopping for. Everything else degrades.
 */
export function validateFlow(blocks: RecoveryFlowBlocks): string[] {
  const errors: string[] = [];
  if (!blocks.flow?.length) return ["flow has no steps"];
  const rounds = Math.max(1, blocks.rounds || 1);
  for (let r = 1; r <= rounds; r++) {
    const groups = new Map<string, { R: number; L: number }>();
    for (const s of stepsForRound(blocks, r)) {
      if (!s.mirror_group) {
        if (s.side && r === 1) errors.push(`step ${s.step} has a side but no mirror_group`);
        continue;
      }
      if (s.side !== "R" && s.side !== "L") {
        if (r === 1) errors.push(`step ${s.step} in ${s.mirror_group} needs side R or L`);
        continue;
      }
      const sum = groups.get(s.mirror_group) ?? { R: 0, L: 0 };
      sum[s.side] += s.duration_sec;
      groups.set(s.mirror_group, sum);
    }
    for (const [g, sum] of groups) {
      if (!sum.R || !sum.L) errors.push(`${g}: missing side ${sum.R ? "L" : "R"} (round ${r})`);
      else if (sum.R !== sum.L) errors.push(`${g}: R ${sum.R}s ≠ L ${sum.L}s (round ${r})`);
    }
  }
  // A missing transition_sec is a SEEDING bug, and artemis's validate_flow
  // refuses to write one. It is deliberately NOT an error here: a plan row
  // seeded before YOGA-4 has none, and refusing to run a session Ryan is
  // standing on the mat for — over a 3 s default — would be the wrong
  // trade every time. buildFlowTimeline falls back; see legacyTransitions().
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
  /** The hold of item `index` starts and the timer runs (YOGA-4: silently). */
  | { type: "hold"; index: number }
  /** `leadin_sec` before the hold ends: announce the next item. YOGA-4 —
   * nothing plays in front of it, so the words start at that instant. */
  | { type: "leadin"; index: number; next: number; kind: LeadKind }
  /** YOGA-5: the one mid-hold line. Once per hold, then silence. */
  | { type: "cuemid"; index: number }
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
  /** The current hold's mid-hold line has been said. Once, then silence. */
  cuedMid: boolean;
}

export function initialFlowState(): FlowState {
  return { index: 0, stage: "transition", stageMs: 0, elapsedMs: 0, paused: false, done: false,
           ledIn: false, cuedMid: false };
}

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
  cueMidSec = DEFAULT_CUE_MID_SEC,
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
    if (s.stage === "hold" && !s.cuedMid && items[s.index].cueMid) {
      // Never inside the lead-in window: a pose short enough for the two to
      // collide gets no mid cue at all rather than two voices at once.
      const at = cueMidSec * 1000;
      const latest = dur - leadinSec * 1000;
      if (at < latest && s.stageMs >= at) {
        s.cuedMid = true;
        events.push({ type: "cuemid", index: s.index });
      }
    }
    if (s.stage === "hold" && !s.ledIn && s.index + 1 < items.length) {
      const kind = leadKind(items, s.index);
      const at = Math.max(0, dur - leadinSec * 1000);
      if (s.stageMs >= at) {
        s.ledIn = true;
        events.push({ type: "leadin", index: s.index, next: s.index + 1, kind });
      }
    }
    if (s.stageMs < dur) break;
    if (s.stage === "transition") {
      s.stage = "hold";
      s.stageMs = 0;
      s.cuedMid = false;
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
  return { state: { ...state, index: target, stage: "transition", stageMs: 0, ledIn: false,
                    cuedMid: false },
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
