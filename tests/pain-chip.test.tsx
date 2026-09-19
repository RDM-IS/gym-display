import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InlineExerciseLogger from "../src/components/InlineExerciseLogger";
import RestDayScreen from "../src/screens/RestDayScreen";
import { exerciseTags } from "../src/lib/adjustment";
import { computePrefill } from "../src/lib/log-state";
import { _resetQueueForTests } from "../src/lib/log-queue";
import {
  composeSetNotes,
  parsePain,
  parseSetup,
  PAIN_REGIONS,
  upsertPain,
} from "../src/lib/set-notes";
import type { LogExerciseIn, LogResponse, Plan, PlannedExercise } from "../src/lib/types";

// ---------------------------------------------------------------------------
// PAIN-1 — in-session pain chip → `pain=<region>:<n>` in session_log.notes.
// ---------------------------------------------------------------------------

describe("pain notes", () => {
  it("composes pain after the machine positions and before the flags", () => {
    expect(
      composeSetNotes({
        finisher: true,
        setup: { seat: 7 },
        pain: [{ region: "shoulder", level: 2 }, { region: "low back", level: 3 }],
        flags: ["felt off"],
      }),
    ).toBe("finisher; seat=7; pain=shoulder:2; pain=low back:3; felt off");
    expect(composeSetNotes({ pain: [{ region: "knee", level: 0 }] })).toBe("pain=knee:0");
    expect(composeSetNotes({ pain: [] })).toBeNull();
  });

  it("round-trips through parsePain, and the positions still parse", () => {
    const pain = [{ region: "shoulder", level: 2 }, { region: "low back", level: 3 }] as const;
    const notes = composeSetNotes({ setup: { seat: 4, pad: 2 }, pain: [...pain], flags: ["machine taken"] });
    expect(parsePain(notes)).toEqual(pain);
    expect(parseSetup(notes)).toEqual({ seat: 4, pad: 2 });
    for (const region of PAIN_REGIONS) {
      for (const level of [0, 5]) {
        expect(parsePain(composeSetNotes({ pain: [{ region, level }] }))).toEqual([{ region, level }]);
      }
    }
  });

  it("ignores unknown regions, out-of-range ratings and free text", () => {
    expect(parsePain("pain=elbow:3")).toEqual([]);
    expect(parsePain("pain=knee:7")).toEqual([]);
    expect(parsePain("sharp pain in shoulder")).toEqual([]);
    expect(parsePain(null)).toEqual([]);
  });

  it("mirrors Artemis's region vocabulary", () => {
    // artemis/health_regions.py REGIONS
    expect([...PAIN_REGIONS]).toEqual([
      "shoulder", "chest", "back", "low back", "arms", "biceps", "triceps",
      "legs", "quads", "hamstrings", "calves", "core", "knee", "hip", "neck",
    ]);
  });

  it("upsertPain re-rates a region in place", () => {
    const a = upsertPain([], { region: "shoulder", level: 1 });
    const b = upsertPain(a, { region: "knee", level: 2 });
    expect(upsertPain(b, { region: "shoulder", level: 3 })).toEqual([
      { region: "shoulder", level: 3 }, { region: "knee", level: 2 },
    ]);
  });

  it("the Status page's pain detector (keyword 'pain') still matches", () => {
    // api/app/routers/health.py PAIN_KEYWORDS — any note containing "pain".
    const note = composeSetNotes({ setup: { seat: 7 }, pain: [{ region: "shoulder", level: 2 }] })!;
    expect(["pain", "injury", "hurt", "tweak"].some((k) => note.toLowerCase().includes(k))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

const REAR_DELT: PlannedExercise = {
  name: "Rear delt fly", format: "reps", target_reps: 15, target_load_lbs: 50, rest_after_sec: 60,
};

let posted: LogExerciseIn[] = [];

beforeEach(() => {
  posted = [];
  _resetQueueForTests();
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body as string) as LogExerciseIn);
      const body: LogResponse = { plan_id: 7, inserted: 1, rows: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return Response.error();
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogger(exercise: PlannedExercise = REAR_DELT) {
  return render(
    <InlineExerciseLogger
      exercise={exercise}
      plan_id={7}
      set_num={1}
      total_sets={2}
      prefill={{ weight: 50, reps: 15, rpe: null, setup: {} }}
      lastHint={null}
      alreadyFullyLogged={false}
      week_num={2}
      onLoggedSet={() => {}}
    />,
  );
}

function pickPain(region: string, level: number) {
  fireEvent.click(screen.getByTestId("pain-chip"));
  const picker = screen.getByTestId("pain-picker");
  // No rating before a region is chosen.
  expect((within(picker).getByRole("button", { name: `Pain ${level}` }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(within(picker).getByRole("button", { name: region }));
  fireEvent.click(within(picker).getByRole("button", { name: `Pain ${level}` }));
}

describe("pain chip", () => {
  it("chip → region → rating → the logged set's notes carry pain=shoulder:2", async () => {
    renderLogger();
    pickPain("shoulder", 2);
    expect(screen.queryByTestId("pain-picker")).toBeNull();
    expect(screen.getByTestId("pain-chip").textContent).toBe("pain (1)");
    expect(screen.getByRole("button", { name: "Remove pain shoulder 2" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Log Rear delt fly set 1" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].sets[0].notes).toBe("pain=shoulder:2");
    expect(posted[0].sets[0].is_skipped).toBe(false);
    expect(posted[0].sets[0].weight_lbs).toBe(50);
  });

  it("several regions, a re-rate, a removal, alongside flags", async () => {
    renderLogger();
    pickPain("shoulder", 1);
    pickPain("low back", 3);
    pickPain("shoulder", 2);
    pickPain("knee", 4);
    fireEvent.click(screen.getByRole("button", { name: "Remove pain knee 4" }));
    fireEvent.click(screen.getByRole("button", { name: "felt off" }));
    fireEvent.click(screen.getByRole("button", { name: "Log Rear delt fly set 1" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].sets[0].notes).toBe("pain=shoulder:2; pain=low back:3; felt off");
  });

  it("cancel closes the picker without recording anything", async () => {
    renderLogger();
    fireEvent.click(screen.getByTestId("pain-chip"));
    fireEvent.click(screen.getByRole("button", { name: "shoulder" }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(screen.queryByTestId("pain-picker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Log Rear delt fly set 1" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].sets[0].notes).toBeNull();
  });

  it("the picker never raises the keyboard and every region is offered", () => {
    const { container } = renderLogger();
    fireEvent.click(screen.getByTestId("pain-chip"));
    const triggers = Array.from(container.querySelectorAll("input, textarea, select, [contenteditable]"))
      .filter((el) => el.getAttribute("inputmode") !== "none");
    expect(triggers).toEqual([]);
    const picker = screen.getByTestId("pain-picker");
    for (const r of PAIN_REGIONS) expect(within(picker).getByRole("button", { name: r })).toBeDefined();
    for (const n of [0, 1, 2, 3, 4, 5]) expect(within(picker).getByRole("button", { name: `Pain ${n}` })).toBeDefined();
  });

  it("is disabled once the set is logged", async () => {
    renderLogger();
    fireEvent.click(screen.getByRole("button", { name: "Log Rear delt fly set 1" }));
    await waitFor(() =>
      expect((screen.getByTestId("pain-chip") as HTMLButtonElement).disabled).toBe(true));
    expect(posted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The artemis side of the ladder, as the display shows it.
// ---------------------------------------------------------------------------

describe("pain-2 lighter targets", () => {
  it("a lowered target beats last session's weight in the prefill", () => {
    const last = { weight_lbs: 25, reps_done: 12 };
    expect(computePrefill("Incline DB press", "reps", 20, 12, null, {}, last, true).weight).toBe(20);
    expect(computePrefill("Incline DB press", "reps", 20, 12, null, {}, last).weight).toBe(25);
    // A set already logged this session still wins.
    const session = { "Incline DB press": [{ set_num: 1, weight_lbs: 15, reps_done: 12, rpe_actual: null }] };
    expect(computePrefill("Incline DB press", "reps", 20, 12, null, session, last, true).weight).toBe(15);
  });

  it("shows the lighter target and the no-history note", () => {
    renderLogger({ ...REAR_DELT, target_load_lbs: 50, load_from: 70 });
    expect(screen.getByText(/target 50 lb × 15 \(last 70 lb\)/)).toBeDefined();
    cleanup();
    renderLogger({ ...REAR_DELT, target_load_lbs: null, load_note: "go lighter than last time" });
    expect(screen.getByTestId("load-note").textContent).toBe("go lighter than last time");
  });

  it("badges", () => {
    expect(exerciseTags({ ...REAR_DELT, target_load_lbs: 50, load_from: 70 }, 6)).toContain("50 lb (last 70)");
    expect(exerciseTags({ ...REAR_DELT, target_load_lbs: null, load_note: "go lighter than last time" }, 6))
      .toContain("lighter than last time");
  });
});

function restPlan(blocks: Record<string, unknown>): Plan {
  return {
    plan_id: 105, plan_date: "2026-09-18", phase: 1, week_num: 1, session_type: "rest_mobility",
    target_rpe: null, est_duration_min: 0, is_skipped: false, blocks,
  } as unknown as Plan;
}

describe("day off / mobility day", () => {
  it("a check-in day off says so and shows the adjustment", () => {
    render(<RestDayScreen plan={restPlan({
      type: "mobility", display_name: "Day off", intensity: "none", duration_min: 0,
      notes: "Day off — no training.",
      adjustment: { rules_fired: ["pain_day_off"], summary: ["Pain shoulder 4/5 → day off."] },
    })} />);
    expect(screen.getByText("Day off")).toBeDefined();
    expect(screen.getByText("No training today.")).toBeDefined();
    expect(screen.getByRole("button", { name: /Adjusted: pain shoulder 4\/5/ })).toBeDefined();
    expect(screen.queryByText(/Mobility ·/)).toBeNull();
  });

  it("a pain mobility day shows minutes and focus", () => {
    render(<RestDayScreen plan={restPlan({
      type: "mobility", display_name: "Mobility / Yoga", duration_min: 30,
      mobility_focus: ["shoulder"], notes: "30 min mobility / yoga (Stretch Trainer + mat)",
      adjustment: { summary: ["Pain shoulder 3/5 → today is Mobility / Yoga: 30 min, Stretch Trainer + mat."] },
    })} />);
    expect(screen.getByText("Mobility · 30 min · shoulder")).toBeDefined();
    expect(screen.getByText(/Stretch Trainer \+ mat\)/)).toBeDefined();
  });
});
