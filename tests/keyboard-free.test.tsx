import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import InlineExerciseLogger from "../src/components/InlineExerciseLogger";
import { applyKey, parseBuffer } from "../src/components/NumericKeypad";
import { computePrefill } from "../src/lib/log-state";
import { _resetQueueForTests } from "../src/lib/log-queue";
import type { LogExerciseIn, LogResponse, PlannedExercise } from "../src/lib/types";

const LEG_PRESS: PlannedExercise = {
  name: "Leg press", format: "reps", target_reps: 12, target_load_lbs: 180, rest_after_sec: 60,
};

function okResponse(): LogResponse {
  return { plan_id: 7, inserted: 1, rows: [] };
}

let posted: LogExerciseIn[] = [];

beforeEach(() => {
  posted = [];
  _resetQueueForTests();
  vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(init.body as string) as LogExerciseIn);
      return new Response(JSON.stringify(okResponse()), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return Response.error();
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderLogger(overrides: Partial<Parameters<typeof InlineExerciseLogger>[0]> = {}) {
  return render(
    <InlineExerciseLogger
      exercise={LEG_PRESS}
      plan_id={7}
      set_num={2}
      total_sets={3}
      prefill={{ weight: 180, reps: 12, rpe: null, setting: null }}
      lastHint={null}
      alreadyFullyLogged={false}
      onLoggedSet={() => {}}
      {...overrides}
    />,
  );
}

/** Nothing in the strength logger may raise the iOS keyboard: no text-entry
 * elements at all, or only ones with inputMode="none". */
function keyboardTriggers(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("input, textarea, select, [contenteditable]")).filter(
    (el) => el.getAttribute("inputmode") !== "none",
  );
}

describe("strength logger never raises the OS keyboard", () => {
  it("renders no keyboard-triggering elements, including with every keypad open", () => {
    const { container } = renderLogger();
    expect(keyboardTriggers(container)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^Weight 180 lb, tap to enter$/ }));
    expect(screen.getByRole("dialog", { name: "Weight keypad" })).toBeDefined();
    expect(keyboardTriggers(document.body)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByTestId("machine-setup-toggle"));
    fireEvent.click(screen.getByRole("button", { name: /Machine setup not set/ }));
    expect(screen.getByRole("dialog", { name: "Machine setup keypad" })).toBeDefined();
    expect(keyboardTriggers(document.body)).toHaveLength(0);
  });

  it("uses the machine stack step (10 lb) on −/+", () => {
    renderLogger();
    fireEvent.click(screen.getByRole("button", { name: "Increase Weight" }));
    expect(screen.getByRole("button", { name: /^Weight 190 lb/ })).toBeDefined();
  });
});

describe("keypad + chips + flags → one session_log row", () => {
  it("writes weight from the keypad, RPE chip, setting=<n> and flags into notes", async () => {
    const logged: unknown[] = [];
    renderLogger({ onLoggedSet: (_n, s) => logged.push(s) });

    // Weight 135 via the keypad (first digit replaces the prefill).
    fireEvent.click(screen.getByRole("button", { name: /^Weight 180 lb, tap to enter$/ }));
    const weightPad = screen.getByRole("dialog", { name: "Weight keypad" });
    for (const d of ["1", "3", "5"]) {
      fireEvent.click(within(weightPad).getByRole("button", { name: `Digit ${d}` }));
    }
    fireEvent.click(within(weightPad).getByRole("button", { name: "Done" }));

    // Machine setup 7 (collapsed on set 2 — one tap to open).
    fireEvent.click(screen.getByTestId("machine-setup-toggle"));
    fireEvent.click(screen.getByRole("button", { name: /Machine setup not set/ }));
    const settingPad = screen.getByRole("dialog", { name: "Machine setup keypad" });
    fireEvent.click(within(settingPad).getByRole("button", { name: "Digit 7" }));
    fireEvent.click(within(settingPad).getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "RPE 8.5" }));
    fireEvent.click(screen.getByRole("button", { name: "machine taken" }));

    fireEvent.click(screen.getByRole("button", { name: "Log Leg press set 2" }));
    await waitFor(() => expect(posted).toHaveLength(1));

    const set = posted[0].sets[0];
    expect(set).toMatchObject({
      set_num: 2, weight_lbs: 135, reps_done: 12, rpe_actual: 8.5, is_skipped: false,
      notes: "setting=7; machine taken",
    });
    await waitFor(() => expect(logged).toHaveLength(1));
    expect(logged[0]).toMatchObject({ set_num: 2, weight_lbs: 135, setting: 7 });
  });

  it("the 'skipped' flag writes is_skipped=true with no metrics", async () => {
    renderLogger({ isFinisher: true });
    fireEvent.click(screen.getByRole("button", { name: "skipped" }));
    expect(screen.getByRole("button", { name: "Log Leg press set 2" }).textContent).toBe("Log set 2: skipped");
    fireEvent.click(screen.getByRole("button", { name: "Log Leg press set 2" }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].sets[0]).toMatchObject({
      is_skipped: true, weight_lbs: null, reps_done: null, rpe_actual: null, notes: "finisher; skipped",
    });
  });

  it("prefills the setting from last session's notes", () => {
    const prefill = computePrefill("Leg press", "reps", 180, 12, null, {}, {
      weight_lbs: 170, reps_done: 12, notes: "setting=4; felt off",
    });
    expect(prefill.setting).toBe(4);
    renderLogger({ prefill });
    // Collapsed on set 2, but the pre-filled value is visible on the toggle.
    expect(screen.getByTestId("machine-setup-toggle").textContent).toBe("Machine setup: 4 ▸");
  });

  it("shows no setting field for dumbbells or bodyweight", () => {
    renderLogger({ exercise: { name: "DB bench press", format: "reps", target_reps: 12 } });
    expect(screen.queryByText(/Machine setup/)).toBeNull();
    cleanup();
    renderLogger({ exercise: { name: "Captain's chair knee raise", format: "reps", target_reps: 12 } });
    expect(screen.queryByRole("button", { name: /Weight/ })).toBeNull();
    expect(screen.queryByText(/Machine setup/)).toBeNull();
  });
});

describe("keypad buffer", () => {
  it("first digit replaces the prefilled value; later digits append", () => {
    let b = applyKey("180", "1", true);
    b = applyKey(b, "3", false);
    b = applyKey(b, "5", false);
    expect(b).toBe("135");
  });

  it("backspace, sign toggle, decimal", () => {
    expect(applyKey("135", "⌫", false)).toBe("13");
    expect(applyKey("-", "⌫", false)).toBe("");
    expect(applyKey("12", "±", false, { allowNegative: true })).toBe("-12");
    expect(applyKey("-12", "±", false, { allowNegative: true })).toBe("12");
    expect(applyKey("12", "±", false, { allowNegative: false })).toBe("12");
    expect(applyKey("12", ".", false, { allowDecimal: true })).toBe("12.");
    expect(applyKey("12.5", ".", false, { allowDecimal: true })).toBe("12.5");
    expect(applyKey("", ".", true, { allowDecimal: true })).toBe("0.");
    expect(applyKey("12", ".", false)).toBe("12");
  });

  it("no leading zeros and a max length", () => {
    expect(applyKey("0", "7", false)).toBe("7");
    expect(applyKey("123456", "7", false)).toBe("123456");
  });

  it("parses the buffer", () => {
    expect(parseBuffer("")).toBeNull();
    expect(parseBuffer("-")).toBeNull();
    expect(parseBuffer("12.5")).toBe(12.5);
    expect(parseBuffer("-3")).toBe(-3);
  });
});
