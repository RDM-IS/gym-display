import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  initialState,
  nextUp,
  prefillReps,
  remainingSec,
  roundLogs,
  roundMeters,
  saveRecord,
  skip,
  summaryLog,
  tick,
  type RcItem,
  type RcPrescription,
  type RcState,
} from "../src/lib/row-circuit";

// ROW-CIRCUIT engine. PUBLIC-FIXTURES: rates 11-13 spm, rows of 20-30 s,
// reps in single digits, year 2031 — legal for the code, nothing like a real
// session.

const T0 = Date.UTC(2031, 2, 10, 10, 0, 0);

function rx(): RcPrescription {
  const rounds = [
    { round: 1, work_sec: 20, spm: 11 },
    { round: 2, work_sec: 30, spm: 12 },
  ];
  const opt = (lever: "rate" | "time" | "repeat", rs = rounds) => ({
    lever, ok: true, reason: null, rounds: rs, row_sec: rs.reduce((a, r) => a + r.work_sec, 0), label: lever,
  });
  return {
    available: true,
    session_type: "row_circuit",
    display_name: "Row circuit",
    rounds: 2, min_rounds: 1, max_rounds: 8,
    base: rounds, has_history: true, last_rounds: 2,
    options: {
      rate: opt("rate", rounds.map((r) => ({ ...r, spm: r.spm + 1 }))),
      time: opt("time", rounds.map((r) => ({ ...r, work_sec: r.work_sec + 60 }))),
      repeat: opt("repeat"),
    },
    default: "rate",
    why: "test",
    rest: { sec: 6, rate: 9 },
    timing: { station_sec: 4, off_rower_sec: 2, between_moves_sec: 1, back_on_rower_sec: 2, cooldown_sec: 5 },
    stations: [
      [
        { name: "Push-up", format: "reps", duration_sec: 4, cue: "c" },
        { name: "Dead bug", format: "reps", duration_sec: 4, cue: "c" },
        { name: "Side plank", format: "hold", duration_sec: 4, cue: "c" },
      ],
      [
        { name: "Push-up", format: "reps", duration_sec: 4, cue: "c" },
        { name: "Bird dog", format: "reps", duration_sec: 4, cue: "c" },
        { name: "Glute bridge", format: "reps", duration_sec: 4, cue: "c" },
      ],
    ],
    last_reps: { "1": { "Push-up": 3 } },
  };
}

function runUntil(items: RcItem[], s: RcState, pred: (s: RcState) => boolean, stepMs = 250): RcState {
  let now = T0 + s.elapsedMs;
  for (let i = 0; i < 100000 && !pred(s); i++) {
    now += stepMs;
    s = tick(items, s, stepMs, now).state;
  }
  return s;
}

describe("timeline", () => {
  it("is row, rest, three stations and a record card per round, then a cool-down", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const kinds = items.filter((i) => i.round === 1 && i.kind !== "move").map((i) => i.kind);
    expect(kinds).toEqual(["get_set", "row", "rest", "station", "station", "station", "record"]);
    expect(items.at(-1)?.kind).toBe("cooldown");
    expect(items.filter((i) => i.kind === "record")).toHaveLength(2);
  });

  it("uses the chosen option's rates and lengths", () => {
    const rows = buildTimeline(rx(), "rate", "easy").filter((i) => i.kind === "row");
    expect(rows.map((r) => r.spm)).toEqual([12, 13]);
    const timed = buildTimeline(rx(), "time", "easy").filter((i) => i.kind === "row");
    expect(timed.map((r) => r.sec)).toEqual([80, 90]);
  });

  it("the rest minute is easy at the rest rate, or stopped", () => {
    const easy = buildTimeline(rx(), "repeat", "easy").find((i) => i.kind === "rest")!;
    expect(easy.spm).toBe(9);
    const stopped = buildTimeline(rx(), "repeat", "stopped").find((i) => i.kind === "rest")!;
    expect(stopped.spm).toBeNull();
    expect(stopped.name).toMatch(/stop/i);
  });

  it("only the record card waits", () => {
    for (const i of buildTimeline(rx(), "repeat", "easy")) {
      expect(i.sec === null).toBe(i.kind === "record");
    }
  });

  it("the Next strip skips transitions", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const restIdx = items.findIndex((i) => i.kind === "rest");
    expect(nextUp(items, restIdx)?.name).toBe("Push-up");
  });
});

describe("engine", () => {
  it("advances on time and stops at the record card", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    const held = tick(items, s, 60_000, T0 + s.elapsedMs + 60_000).state;
    expect(items[held.index].kind).toBe("record");
    expect(remainingSec(items, held)).toBeNull();
  });

  it("saving the card moves on to the next round", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    let s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    s = saveRecord(items, s, T0 + s.elapsedMs).state;
    expect(items[s.index].round).toBe(2);
  });

  it("stamps a closed window on every item it passes, in order", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    for (let i = 0; i < s.index; i++) {
      const w = s.windows[i];
      expect(w.end).not.toBeNull();
      expect(w.end!).toBeGreaterThanOrEqual(w.start);
      if (i > 0) expect(w.start).toBe(s.windows[i - 1].end);
    }
    const row = items.findIndex((i) => i.kind === "row");
    expect(s.windows[row].activeMs).toBe(20_000);
  });

  it("paused time does not run the clock", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const s = { ...initialState(T0), paused: true };
    expect(tick(items, s, 5000, T0 + 5000).state).toBe(s);
  });

  it("warns five seconds before a row ends", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    let s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "row");
    const evs = [];
    let now = T0 + s.elapsedMs;
    for (let i = 0; i < 80; i++) {
      now += 250;
      const r = tick(items, s, 250, now);
      s = r.state;
      evs.push(...r.events);
    }
    expect(evs.filter((e) => e.type === "warn")).toHaveLength(1);
  });

  it("skip never passes a record card", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    const s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    expect(skip(items, s, T0 + 1).state).toBe(s);
  });

  it("finishes with a done event after the cool-down", () => {
    const items = buildTimeline(rx(), "repeat", "easy");
    let s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    s = saveRecord(items, s, T0 + s.elapsedMs).state;
    s = runUntil(items, s, (x) => items[x.index].kind === "record");
    s = saveRecord(items, s, T0 + s.elapsedMs).state;
    s = runUntil(items, s, (x) => x.done);
    expect(s.done).toBe(true);
  });
});

describe("logging", () => {
  function roundOne() {
    const items = buildTimeline(rx(), "repeat", "easy");
    const s = runUntil(items, initialState(T0), (x) => items[x.index].kind === "record");
    return { items, s };
  }

  it("one Row block and one row per station, all carrying their windows", () => {
    const { items, s } = roundOne();
    const logs = roundLogs(items, s, 1, { spm: 11, metersTotal: 90, reps: { "Push-up": 4, "Dead bug": 5 } }, 90,
                           { round: 1, work_sec: 20, spm: 11 });
    expect(logs.map((l) => l.exercise)).toEqual(["Row", "Push-up", "Dead bug", "Side plank"]);
    for (const l of logs) {
      expect(l.adhoc_session_type).toBe("row_circuit");
      expect(l.plan_id).toBeNull();
      expect(l.sets[0].set_num).toBe(1);
      expect(l.sets[0].started_at).toMatch(/^2031-03-10T/);
      expect(l.sets[0].ended_at).toMatch(/^2031-03-10T/);
    }
    const row = logs[0];
    expect(row.log_type).toBe("cardio_block");
    expect(row.modality).toBe("row");
    expect(row.sets[0].stroke_rate).toBe(11);
    expect(row.sets[0].distance_m).toBe(90);
    expect(row.sets[0].duration_sec).toBe(20);
  });

  it("a hold records no reps; a reps move records its count", () => {
    const { items, s } = roundOne();
    const logs = roundLogs(items, s, 1, { spm: 11, metersTotal: null, reps: { "Push-up": 4 } }, null,
                           { round: 1, work_sec: 20, spm: 11 });
    expect(logs.find((l) => l.exercise === "Side plank")!.sets[0].reps_done).toBeNull();
    expect(logs.find((l) => l.exercise === "Push-up")!.sets[0].reps_done).toBe(4);
    expect(logs[0].sets[0].distance_m).toBeNull();
  });

  it("round meters are the difference of monitor totals, never negative", () => {
    expect(roundMeters(90, null)).toBe(90);
    expect(roundMeters(150, 90)).toBe(60);
    expect(roundMeters(40, 90)).toBeNull();
    expect(roundMeters(null, 90)).toBeNull();
  });

  it("prefill: last session's round first, then this session's earlier round", () => {
    const r = rx();
    expect(prefillReps(r, 1, "Push-up", {})).toBe(3);
    expect(prefillReps(r, 2, "Push-up", { 1: { "Push-up": 6 } })).toBe(6);
    expect(prefillReps(r, 2, "Bird dog", {})).toBeNull();
  });

  it("the summary says partial until the session is done", () => {
    const { s } = roundOne();
    const body = summaryLog(s, 2, "rate", 0);
    expect(body.log_type).toBe("session_summary");
    expect(body.sets[0].notes).toMatch(/^row_circuit: partial/);
    expect(body.sets[0].notes).toMatch(/0 of 2 rounds/);
  });
});
