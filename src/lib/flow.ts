import type { FlowStep, RecoveryFlowBlocks } from "./types";

// ---------------------------------------------------------------------------
// Recovery Flow (YOGA-1) — a hands-free timeline.
//
//   pre (office: Stretch Trainer 8 min)
//   round 1: every flow step
//   round 2: every flow step, holds doubled on steps 10–16
//   close: easy-pose breathing
//
// Everything here is pure so the engine can be driven by fake timers.
// ---------------------------------------------------------------------------

export type FlowItemKind = "pre" | "pose" | "close";

export interface FlowItem {
  kind: FlowItemKind;
  /** Pose / block name. */
  name: string;
  /** Name + side, for lists and the preview ("High lunge · Right leg forward"). */
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
  /** The other side of this item's mirror group starts here → the preview
   * before it is the "Switch sides" screen. */
  switchBefore: boolean;
  /** First pose of a round > 1 → the preview before it announces the round. */
  roundStart: boolean;
  /** What the voice says when this item starts. */
  speech: string;
}

export const DEFAULT_PREVIEW_SEC = 5;

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

function sideWords(s: FlowStep): string {
  if (s.side_label) return s.side_label;
  if (s.side === "R") return "Right side";
  if (s.side === "L") return "Left side";
  return "";
}

function speechFor(name: string, s?: FlowStep): string {
  if (!s || !s.side) return name;
  return `${name}, ${sideWords(s).toLowerCase()}`;
}

export function buildFlowTimeline(blocks: RecoveryFlowBlocks): FlowItem[] {
  const rounds = Math.max(1, blocks.rounds || 1);
  const items: FlowItem[] = [];
  for (const p of blocks.pre ?? []) {
    items.push({
      kind: "pre", name: p.name, title: p.name, side: null, sideLabel: null,
      cue: p.cue ?? null, easier: null, duration_sec: p.duration_sec, round: null,
      totalRounds: rounds, step: null, mirrorGroup: null, switchBefore: false,
      roundStart: false, speech: p.cue ? `${p.name}. ${p.cue}` : p.name,
    });
  }
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
      items.push({
        kind: "pose", name: s.name, title: label ? `${s.name} · ${label}` : s.name,
        side: s.side, sideLabel: label, cue: s.cue ?? null, easier: s.easier ?? null,
        duration_sec: holds[i], round: r, totalRounds: rounds, step: s.step,
        mirrorGroup: s.mirror_group, switchBefore, roundStart: i === 0 && r > 1,
        speech: speechFor(s.name, s),
      });
    });
  }
  if (blocks.close) {
    const c = blocks.close;
    items.push({
      kind: "close", name: c.name, title: c.name, side: null, sideLabel: null,
      cue: c.cue ?? null, easier: null, duration_sec: c.duration_sec, round: null,
      totalRounds: rounds, step: null, mirrorGroup: null, switchBefore: false,
      roundStart: false, speech: c.name,
    });
  }
  return items;
}

export function flowTotalSec(blocks: RecoveryFlowBlocks): number {
  return buildFlowTimeline(blocks).reduce((a, i) => a + i.duration_sec, 0);
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

export type FlowEvent =
  | { type: "enter"; index: number }
  | { type: "preview"; index: number; next: number; kind: "next" | "switch" | "round" }
  | { type: "done" };

export interface FlowState {
  index: number;
  /** ms spent in the current item. */
  itemMs: number;
  /** ms actually spent in the flow (paused time excluded). */
  elapsedMs: number;
  paused: boolean;
  done: boolean;
  /** The current item's preview has fired. */
  previewed: boolean;
}

export function initialFlowState(): FlowState {
  return { index: 0, itemMs: 0, elapsedMs: 0, paused: false, done: false, previewed: false };
}

export function previewKind(items: FlowItem[], index: number): "next" | "switch" | "round" {
  const next = items[index + 1];
  if (!next) return "next";
  if (next.switchBefore) return "switch";
  if (next.roundStart) return "round";
  return "next";
}

/** Advance by dtMs. Returns the new state and the events crossed, in order. */
export function tickFlow(
  items: FlowItem[],
  state: FlowState,
  dtMs: number,
  previewSec = DEFAULT_PREVIEW_SEC,
): { state: FlowState; events: FlowEvent[] } {
  if (state.paused || state.done || dtMs <= 0) return { state, events: [] };
  const s = { ...state };
  const events: FlowEvent[] = [];
  let left = dtMs;
  while (left > 0 && !s.done) {
    const dur = items[s.index].duration_sec * 1000;
    const previewAt = Math.max(0, dur - previewSec * 1000);
    const step = Math.min(left, dur - s.itemMs);
    s.itemMs += step;
    s.elapsedMs += step;
    left -= step;
    if (!s.previewed && s.itemMs >= previewAt && s.index + 1 < items.length) {
      s.previewed = true;
      events.push({ type: "preview", index: s.index, next: s.index + 1,
                    kind: previewKind(items, s.index) });
    }
    if (s.itemMs >= dur) {
      if (s.index + 1 >= items.length) {
        s.done = true;
        events.push({ type: "done" });
      } else {
        s.index += 1;
        s.itemMs = 0;
        s.previewed = false;
        events.push({ type: "enter", index: s.index });
      }
    }
  }
  return { state: s, events };
}

/** Swipe: jump to the next (or previous) item. Skipped time isn't counted. */
export function skipFlow(items: FlowItem[], state: FlowState, dir: 1 | -1): { state: FlowState; events: FlowEvent[] } {
  if (state.done) return { state, events: [] };
  const target = state.index + dir;
  if (target < 0) return { state: { ...state, itemMs: 0, previewed: false }, events: [{ type: "enter", index: 0 }] };
  if (target >= items.length) return { state: { ...state, done: true }, events: [{ type: "done" }] };
  return { state: { ...state, index: target, itemMs: 0, previewed: false },
           events: [{ type: "enter", index: target }] };
}

export function remainingInItemSec(items: FlowItem[], state: FlowState): number {
  if (state.done) return 0;
  return Math.max(0, Math.ceil((items[state.index].duration_sec * 1000 - state.itemMs) / 1000));
}

export function remainingTotalSec(items: FlowItem[], state: FlowState): number {
  if (state.done) return 0;
  let ms = items[state.index].duration_sec * 1000 - state.itemMs;
  for (let i = state.index + 1; i < items.length; i++) ms += items[i].duration_sec * 1000;
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
