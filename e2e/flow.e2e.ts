import { expect, test, type Page } from "@playwright/test";
import office from "../tests/fixtures/recovery-flow-office.json" with { type: "json" };
import home from "../tests/fixtures/recovery-flow-home.json" with { type: "json" };
import { buildFlowTimeline, type FlowItem } from "../src/lib/flow";
import type { RecoveryFlowBlocks } from "../src/lib/types";

// YOGA-1 Recovery Flow on an iPad-sized WebKit page, with Playwright's fake
// clock: one Start tap, then no input at all.

const TODAY = "2026-09-17";

// Tonight's real 9/17 row: session_type is still rest_mobility, the blocks are
// the flow. It must NOT be redirected to Status.
const OFFICE_PLAN = { ...office, plan_date: TODAY, session_type: "rest_mobility" };
const HOME_PLAN = { ...home, plan_date: TODAY };

function status(plan: { plan_id: number; session_type: string }) {
  return {
    today: TODAY, window_start: "2026-09-12", window_end: "2026-09-22",
    today_summary: { plan_id: plan.plan_id, session_type: plan.session_type, is_skipped: false,
                     is_logged: false, exists: true },
    banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
    day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
  };
}

async function mockApi(page: Page, plan: typeof OFFICE_PLAN | typeof HOME_PLAN) {
  const posted: Array<{ log_type: string; sets: Array<{ duration_sec: number; notes: string }> }> = [];
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: plan });
    if (path.endsWith("/status")) return route.fulfill({ json: status(plan) });
    if (path.endsWith("/log")) {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { plan_id: plan.plan_id, inserted: 1, rows: [] } });
    }
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: plan.plan_id, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: { days: [] } });
    return route.fulfill({ json: { by_exercise: {} } });
  });
  return posted;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

/** Record every Switch sides / Round screen as it appears (title + what's
 * next; the move countdown inside it is left out). */
async function watchCues(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __cues: string[] };
    w.__cues = [];
    let last = "";
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="flow-switch"], [data-testid="flow-round-change"]');
      const text = el
        ? `${el.querySelector(".flow-switch-title")?.textContent}|${el.querySelector(".flow-switch-next")?.textContent}`
        : "";
      if (text && text !== last) w.__cues.push(text);
      last = text;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** When each item's transition starts, its hold starts and its hold ends —
 * seconds after Start, from the same timeline the app runs. */
function schedule(blocks: unknown) {
  const items = buildFlowTimeline(blocks as RecoveryFlowBlocks);
  let t = 0;
  const out = items.map((it) => {
    const move = t;
    const hold = move + it.transitionSec;
    t = hold + it.duration_sec;
    return { it, move, hold, end: t };
  });
  const find = (pred: (i: FlowItem) => boolean) => out.find((x) => pred(x.it))!;
  return { items, out, total: t, find };
}

const speech = (page: Page) =>
  page.evaluate(() => [...(window as unknown as { __gymDisplaySpeech: string[] }).__gymDisplaySpeech]);
/** Freeze the fake clock (install() lets it flow in real time) so every
 * second is test-driven, then tap Start. */
async function pausedStart(page: Page, at: string) {
  await page.clock.pauseAt(new Date(at));
  await page.getByRole("button", { name: "Start" }).tap();
}

async function runSeconds(page: Page, seconds: number) {
  for (let i = 0; i < seconds; i++) await page.clock.runFor(1000);
}

test("office flow runs hands-free: meditation, Stretch Trainer, spoken lead-in + move cue, switch sides, round 2, savasana, auto-log", async ({ page }) => {
  test.setTimeout(300_000);
  const S = schedule(office.blocks);
  expect(S.total).toBe(2432);
  await page.clock.install({ time: new Date("2026-09-17T10:59:00Z") });
  const posted = await mockApi(page, OFFICE_PLAN);
  await page.goto("/today");
  await expect(page.getByTestId("flow-ready")).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("40:32 · 2 rounds · office gym")).toBeVisible();
  // Start is on screen without scrolling.
  const startBox = await page.getByRole("button", { name: "Start" }).boundingBox();
  const vh = page.viewportSize()!.height;
  expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(vh);
  expect(startBox!.height).toBeGreaterThanOrEqual(56);
  // YOGA-5: the voice controls live on the ready screen and nowhere else —
  // nothing here should be reachable once Ryan's hands are on the mat.
  await expect(page.getByTestId("flow-settings")).toBeVisible();
  await expect(page.getByTestId("voice-rate")).toHaveValue("0.85");
  await expect(page.getByTestId("midcue-toggle")).toBeChecked();
  // …and reachable without scrolling past twenty poses, in both orientations.
  const setBox = await page.getByTestId("flow-settings").boundingBox();
  expect(setBox!.y + setBox!.height,
         "voice settings must be on screen without scrolling").toBeLessThanOrEqual(
    page.viewportSize()!.height);
  await shot(page, "flow-0-ready");

  await pausedStart(page, "2026-09-17T11:00:00Z");
  // Nothing below touches the page again.
  await watchCues(page);
  // Start: the lead-in, then "Move into position" for the first pose.
  expect(await speech(page)).toEqual(["We'll begin with seated meditation for 60 seconds."]);
  await expect(page.getByTestId("flow-name")).toHaveText("Seated meditation");
  await expect(page.getByTestId("flow-move")).toHaveText("Move into position");
  await expect(page.getByTestId("flow-clock")).toHaveText("5");
  await expect(page.getByTestId("flow-next-title")).toHaveText("Next: Stretch Trainer");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await shot(page, "flow-1-move-into-meditation");
  await runSeconds(page, 5);
  await expect(page.getByTestId("flow-clock")).toHaveText("1:00");
  await expect(page.getByTestId("flow-move")).toHaveCount(0);

  const st = S.find((i) => i.name === "Stretch Trainer");
  await runSeconds(page, st.hold + 1 - 5);
  await expect(page.getByTestId("flow-name")).toHaveText("Stretch Trainer");
  await expect(page.getByText("Follow the 8 placard stretches")).toBeVisible();
  await expect(page.getByTestId("flow-clock")).toHaveText("7:59");
  await shot(page, "flow-1b-stretch-trainer");

  // YOGA-4: the side switch is at the top of the crescent (step 7), the
  // lead-in lands 7 s out with nothing in front of it, the move cue at 0.
  const lunge = S.find((i) => i.step === "7" && i.round === 1);
  let t = st.hold + 1;
  await runSeconds(page, lunge.move - 8 - t); t = lunge.move - 8;
  expect((await speech(page)).at(-1)).not.toContain("left leg");
  await runSeconds(page, 1); t += 1;                          // exactly 7 s before the hold ends
  expect((await speech(page)).at(-1)).toBe("Next, crescent lunge, left leg forward, for 40 seconds.");
  await expect(page.getByTestId("flow-name")).toHaveText("Crescent lunge");
  await expect(page.getByTestId("flow-next-title")).toHaveText("Next: Crescent lunge · Left leg forward");
  await runSeconds(page, 7); t += 7;                          // 0 → the move cue + switch screen
  // YOGA-5: the move cue is the Sanskrit, phonetic, with no side — the side
  // came 7 s ago in English and the screen still shows it.
  expect((await speech(page)).at(-1)).toBe("Move to AHSH-tah chahn-DRAH-sah-nah.");
  await expect(page.getByTestId("flow-sanskrit")).toHaveText("Ashta Chandrasana");
  const sw = page.getByTestId("flow-switch");
  await expect(sw).toBeVisible();
  await expect(sw).toContainText("Switch sides");
  await expect(sw).toContainText("Left leg forward");
  await expect(sw).toContainText("Move into position");
  await shot(page, "flow-2-switch-sides");

  await runSeconds(page, lunge.hold + 1 - t); t = lunge.hold + 1;
  await expect(sw).toHaveCount(0);
  await expect(page.getByTestId("flow-name")).toHaveText("Crescent lunge");
  await expect(page.getByTestId("flow-side")).toHaveText("Left leg forward");
  await expect(page.getByText("Easier: Knee down")).toBeVisible();
  await expect(page.getByTestId("flow-clock")).toHaveText("0:39");
  await expect(page.getByTestId("flow-round")).toHaveText("Round 1/2");
  await shot(page, "flow-3-left-lunge");                 // English large, Sanskrit beneath

  const r2 = S.find((i) => i.roundStart);
  await runSeconds(page, r2.move + 1 - t); t = r2.move + 1;
  await expect(page.getByTestId("flow-round")).toHaveText("Round 2/2");
  await expect(page.getByTestId("flow-round-change")).toBeVisible();
  await shot(page, "flow-4-round-2");

  const sav = S.out.at(-1)!;
  await runSeconds(page, sav.move + 1 - t); t = sav.move + 1;
  await expect(page.getByTestId("flow-name")).toHaveText("Savasana");
  await expect(page.getByTestId("flow-move")).toBeVisible();
  await expect(page.getByTestId("flow-next-title")).toHaveText("Last one — the flow ends after this");
  expect((await speech(page)).slice(-2)).toEqual(["Next we'll move into savasana for 3 minutes.",
                                                  "Move to shah-VAH-sah-nah."]);
  await expect(page.getByTestId("flow-sanskrit")).toHaveText("Shavasana");
  await shot(page, "flow-4b-savasana");

  await runSeconds(page, S.total - t + 3);
  await expect(page.getByTestId("flow-done")).toBeVisible();
  await expect(page.getByTestId("flow-log-status")).toHaveText("Logged ✓");
  await shot(page, "flow-5-done");

  const cues = await page.evaluate(() => (window as unknown as { __cues: string[] }).__cues);
  const switches = cues.filter((c) => c.startsWith("Switch sides"));
  expect(switches).toEqual([
    // each round: lunge unit, supine twist, wind release, side bend, seated twist
    "Switch sides|Crescent lunge · Left leg forward", "Switch sides|Supine twist · Left side",
    "Switch sides|Wind release · Left knee", "Switch sides|Seated twist · Twist right",
    "Switch sides|Seated side bend · Lean right",
    "Switch sides|Crescent lunge · Left leg forward", "Switch sides|Supine twist · Left side",
    "Switch sides|Wind release · Left knee", "Switch sides|Seated twist · Twist right",
    "Switch sides|Seated side bend · Lean right",
  ]);
  expect(cues.filter((c) => c.startsWith("Round 2"))).toHaveLength(1);

  // Every pose: lead-in, then move cue — each exactly once, in order.
  const said = await speech(page);
  // YOGA-5: each hold also carries its one mid-hold line — at the start for
  // meditation and savasana, 12 s in for a pose, then silence.
  const expected: string[] = [S.items[0].leadIn];
  if (S.items[0].cueMid) expected.push(S.items[0].cueMid);
  for (const it of S.items.slice(1)) {
    expected.push(it.leadIn, it.moveCue);
    if (it.cueMid) expected.push(it.cueMid);
  }
  expect(said).toEqual([...expected, "Flow complete"]);
  // Exactly one mid-hold line per hold that has one — never two, never zero.
  const midLines = S.items.filter((i) => i.cueMid).map((i) => i.cueMid!);
  for (const line of new Set(midLines)) {
    expect(said.filter((x) => x === line)).toHaveLength(
      midLines.filter((x) => x === line).length);
  }
  // YOGA-4: not one tone in the whole run — voice only.
  expect(await page.evaluate(() =>
    (window as unknown as { __gymDisplayTones?: string[] }).__gymDisplayTones ?? [])).toEqual([]);

  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    plan_id: 104, log_type: "session_summary",
    sets: [{ duration_sec: 2432, notes: "recovery_flow: complete 40 min" }],
  });
});

test("backgrounding at 50% logs a partial; coming back resumes without a tap", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-09-19T13:59:00Z") });
  const posted = await mockApi(page, HOME_PLAN);
  await page.goto("/today");
  await pausedStart(page, "2026-09-19T14:00:00Z");
  await expect(page.getByTestId("flow-name")).toHaveText("Seated meditation");
  await runSeconds(page, 990);

  const setVisibility = (state: "hidden" | "visible") => page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

  await setVisibility("hidden");
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].sets[0]).toMatchObject({
    duration_sec: 990, notes: "recovery_flow: partial 16 of 32 min",
  });
  await page.clock.runFor(60_000);
  await setVisibility("visible");
  await expect(page.getByTestId("flow-paused")).toHaveCount(0);
  const before = await page.getByTestId("flow-clock").textContent();
  await runSeconds(page, 2);
  await expect(page.getByTestId("flow-clock")).not.toHaveText(before!);
});

test("tap pauses and resumes; the remaining time holds", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-19T13:59:00Z") });
  const posted = await mockApi(page, HOME_PLAN);
  await page.goto("/today");
  await pausedStart(page, "2026-09-19T14:00:00Z");
  // Pause inside the first transition: the move countdown holds too.
  await runSeconds(page, 2);
  await expect(page.getByTestId("flow-clock")).toHaveText("3");
  await page.getByTestId("flow-name").tap();
  await expect(page.getByTestId("flow-paused")).toBeVisible();
  await runSeconds(page, 20);
  await expect(page.getByTestId("flow-clock")).toHaveText("3");
  await page.getByTestId("flow-paused").tap();

  // 3 s to finish moving, then 5 s into the minute of meditation.
  await runSeconds(page, 8);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:55");
  await page.getByTestId("flow-name").tap();
  await expect(page.getByTestId("flow-paused")).toBeVisible();
  await shot(page, "flow-6-paused");
  await runSeconds(page, 30);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:55");

  await page.getByTestId("flow-paused").tap();
  await expect(page.getByTestId("flow-paused")).toHaveCount(0);
  await runSeconds(page, 5);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:50");
  expect(posted).toHaveLength(0);
});

// ── YOGA-2: pose figures ────────────────────────────────────────────────────

type Box = { x: number; y: number; width: number; height: number };

test("active pose shows its figure, mirrored per side, with no layout shift", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-09-19T12:29:00Z") });
  await mockApi(page, HOME_PLAN);
  await page.goto("/today");
  // Ready list: a thumbnail on every drawn row.
  await expect(page.getByTestId("flow-ready").getByTestId("pose-figure")).toHaveCount(22);  // meditation + 20 poses + savasana
  const S = schedule(home.blocks);
  await pausedStart(page, "2026-09-19T12:30:00Z");

  const figure = page.getByTestId("flow-body").getByTestId("pose-figure");
  await expect(figure).toHaveAttribute("data-pose", "seated meditation");

  // Snapshot the figure + name boxes on the very first mutation that shows a
  // new pose name, before any later frame can move them.
  await page.evaluate(() => {
    const w = window as unknown as { __firstPaint: Record<string, unknown> };
    w.__firstPaint = {};
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    new MutationObserver(() => {
      const name = document.querySelector('[data-testid="flow-name"]');
      const key = name?.textContent ?? "";
      if (key && !(key in w.__firstPaint)) {
        w.__firstPaint[key] = {
          figure: box(document.querySelector('[data-testid="flow-body"] [data-testid="pose-figure"]')),
          name: box(name),
        };
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });

  // High lunge, right leg forward (base drawing), 1 s into its hold.
  const lungeR = S.find((i) => i.step === "5" && i.round === 1);
  await runSeconds(page, lungeR.hold + 1);
  await expect(page.getByTestId("flow-name")).toHaveText("High lunge");
  await expect(page.getByTestId("flow-side")).toHaveText("Right leg forward");
  await expect(figure).toHaveAttribute("data-pose", "high lunge");
  await expect(figure).toHaveAttribute("data-mirrored", "false");
  await shot(page, "flow-7-figure-lunge-right");

  // Same pose one clock second (and its frames) later: nothing moved.
  const settled = async () => ({
    figure: (await figure.boundingBox()) as Box,
    name: (await page.getByTestId("flow-name").boundingBox()) as Box,
  });
  const first = await page.evaluate(() =>
    (window as unknown as { __firstPaint: Record<string, { figure: Box; name: Box }> }).__firstPaint["High lunge"]);
  // The fake clock drives rAF too, so one clock second also runs the frames.
  await runSeconds(page, 1);
  const later = await settled();
  for (const k of ["figure", "name"] as const) {
    expect(first[k], `${k} was missing on first paint`).not.toBeNull();
    for (const p of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(first[k][p] - later[k][p]), `${k}.${p} shifted`).toBeLessThanOrEqual(0.5);
    }
  }

  // Layout: portrait stacks figure (~40% of the height) over the text;
  // landscape puts the figure left of the text.
  const vp = page.viewportSize()!;
  const text = (await page.locator(".flow-text").boundingBox()) as Box;
  if (vp.width > vp.height) {
    expect(later.figure.x + later.figure.width).toBeLessThanOrEqual(text.x + 0.5);
    expect(later.figure.width / vp.width).toBeGreaterThan(0.35);
  } else {
    expect(later.figure.y + later.figure.height).toBeLessThanOrEqual(later.name.y);
    expect(later.figure.height / vp.height).toBeGreaterThan(0.37);
    expect(later.figure.height / vp.height).toBeLessThan(0.43);
  }
  // The whole screen still fits: the cue isn't pushed off the bottom.
  const cue = (await page.locator(".flow-cue").boundingBox()) as Box;
  expect(cue.y + cue.height).toBeLessThanOrEqual(vp.height);

  // The Next strip is there for the whole hold, with a small figure.
  const next = page.getByTestId("flow-next");
  await expect(next).toBeVisible();
  await expect(next.getByTestId("pose-figure")).toHaveAttribute("data-pose", "crescent lunge");
  // The strip never covers the cue or the easier option.
  const bar = (await next.boundingBox()) as Box;
  for (const sel of [".flow-cue", ".flow-easier"]) {
    const b = (await page.locator(sel).boundingBox()) as Box;
    expect(b.y + b.height, `${sel} runs under the Next strip`).toBeLessThanOrEqual(bar.y);
  }
  // …and it doesn't move during the hold or into the next transition.
  await runSeconds(page, lungeR.end - lungeR.hold - 2);
  const bar2 = (await next.boundingBox()) as Box;
  expect(Math.abs(bar2.y - bar.y)).toBeLessThanOrEqual(0.5);
  await shot(page, "flow-8-next-strip");

  // The switch screen before the left side shows the mirrored figure. Since
  // YOGA-4 that is the crescent lunge (step 7), not the high lunge.
  const lungeL = S.find((i) => i.step === "7" && i.round === 1);
  await runSeconds(page, lungeL.move + 1 - (lungeR.end - 1));
  const sw = page.getByTestId("flow-switch");
  await expect(sw).toBeVisible();
  await expect(sw.getByTestId("pose-figure")).toHaveAttribute("data-mirrored", "true");
  await shot(page, "flow-9-switch-figure");

  await runSeconds(page, lungeL.hold - lungeL.move);
  await expect(page.getByTestId("flow-side")).toHaveText("Left leg forward");
  await expect(figure).toHaveAttribute("data-mirrored", "true");
  await shot(page, "flow-10-figure-lunge-left");
});
