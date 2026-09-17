import { expect, test, type Page } from "@playwright/test";
import office from "../tests/fixtures/recovery-flow-office.json" with { type: "json" };
import home from "../tests/fixtures/recovery-flow-home.json" with { type: "json" };

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

/** Record every Switch sides / Round screen as it appears. */
async function watchCues(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __cues: string[] };
    w.__cues = [];
    let last = "";
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="flow-switch"], [data-testid="flow-round-change"]');
      const text = el ? (el.textContent ?? "") : "";
      if (text && text !== last) w.__cues.push(text);
      last = text;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

/** Freeze the fake clock (install() lets it flow in real time) so every
 * second is test-driven, then tap Start. */
async function pausedStart(page: Page, at: string) {
  await page.clock.pauseAt(new Date(at));
  await page.getByRole("button", { name: "Start" }).tap();
}

async function runSeconds(page: Page, seconds: number) {
  for (let i = 0; i < seconds; i++) await page.clock.runFor(1000);
}

test("office flow runs hands-free: Stretch Trainer, switch-sides cues, round 2, auto-log", async ({ page }) => {
  test.setTimeout(240_000);
  await page.clock.install({ time: new Date("2026-09-17T10:59:00Z") });
  const posted = await mockApi(page, OFFICE_PLAN);
  await page.goto("/today");
  await expect(page.getByTestId("flow-ready")).toBeVisible();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText("37:30 · 2 rounds · office gym")).toBeVisible();
  // Start is on screen without scrolling.
  const startBox = await page.getByRole("button", { name: "Start" }).boundingBox();
  const vh = page.viewportSize()!.height;
  expect(startBox!.y + startBox!.height).toBeLessThanOrEqual(vh);
  expect(startBox!.height).toBeGreaterThanOrEqual(56);
  await shot(page, "flow-0-ready");

  await pausedStart(page, "2026-09-17T11:00:00Z");
  // Nothing below touches the page again.
  await watchCues(page);
  await expect(page.getByTestId("flow-name")).toHaveText("Stretch Trainer");
  await expect(page.getByText("Follow the 8 placard stretches")).toBeVisible();
  await expect(page.getByTestId("flow-clock")).toHaveText("8:00");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await shot(page, "flow-1-stretch-trainer");

  // Stretch Trainer 480 s + steps 1-7 (240 s) → the switch before the
  // left-leg lunge shows at 715 s.
  await runSeconds(page, 716);
  const sw = page.getByTestId("flow-switch");
  await expect(sw).toBeVisible();
  await expect(sw).toContainText("Switch sides");
  await expect(sw).toContainText("Left leg forward");
  const tones = await page.evaluate(() => (window as unknown as { __gymDisplayTones: string[] }).__gymDisplayTones);
  expect(tones).toContain("switch");
  await shot(page, "flow-2-switch-sides");

  await runSeconds(page, 5);
  await expect(page.getByTestId("flow-name")).toHaveText("High lunge");
  await expect(page.getByTestId("flow-side")).toHaveText("Left leg forward");
  await expect(page.getByText("Easier: Knee down")).toBeVisible();
  await expect(page.getByTestId("flow-round")).toHaveText("Round 1/2");
  await shot(page, "flow-3-left-lunge");

  // Rest of round 1 (390 s from here, less the 1 s we're in) → round 2.
  await runSeconds(page, 390);
  await expect(page.getByTestId("flow-round")).toHaveText("Round 2/2");
  await shot(page, "flow-4-round-2");

  await runSeconds(page, 2250 - 716 - 5 - 390 + 3);
  await expect(page.getByTestId("flow-done")).toBeVisible();
  await expect(page.getByTestId("flow-log-status")).toHaveText("Logged ✓");
  await shot(page, "flow-5-done");

  const cues = await page.evaluate(() => (window as unknown as { __cues: string[] }).__cues);
  const switches = cues.filter((c) => c.startsWith("Switch sides"));
  expect(switches).toEqual([
    // each round: lunge unit, supine twist, wind release, side bend, seated twist
    "Switch sidesLeft leg forward", "Switch sidesLeft side", "Switch sidesLeft knee",
    "Switch sidesLean right", "Switch sidesTwist right",
    "Switch sidesLeft leg forward", "Switch sidesLeft side", "Switch sidesLeft knee",
    "Switch sidesLean right", "Switch sidesTwist right",
  ]);
  expect(cues.filter((c) => c.startsWith("Round 2"))).toHaveLength(1);

  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    plan_id: 104, log_type: "session_summary",
    sets: [{ duration_sec: 2250, notes: "recovery_flow: complete 37 min" }],
  });
});

test("backgrounding at 50% logs a partial; coming back resumes without a tap", async ({ page }) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-09-19T13:59:00Z") });
  const posted = await mockApi(page, HOME_PLAN);
  await page.goto("/today");
  await pausedStart(page, "2026-09-19T14:00:00Z");
  await expect(page.getByTestId("flow-name")).toHaveText("Child's pose");
  await runSeconds(page, 885);

  const setVisibility = (state: "hidden" | "visible") => page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

  await setVisibility("hidden");
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].sets[0]).toMatchObject({
    duration_sec: 885, notes: "recovery_flow: partial 14 of 30 min",
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
  await runSeconds(page, 10);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:20");

  await page.getByTestId("flow-name").tap();
  await expect(page.getByTestId("flow-paused")).toBeVisible();
  await shot(page, "flow-6-paused");
  await runSeconds(page, 30);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:20");

  await page.getByTestId("flow-paused").tap();
  await expect(page.getByTestId("flow-paused")).toHaveCount(0);
  await runSeconds(page, 5);
  await expect(page.getByTestId("flow-clock")).toHaveText("0:15");
  expect(posted).toHaveLength(0);
});
