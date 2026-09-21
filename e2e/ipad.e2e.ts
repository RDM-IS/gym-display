import { expect, test, type Page } from "@playwright/test";
import overview from "../tests/fixtures/overview.json" with { type: "json" };

// ---------------------------------------------------------------------------
// GD-IPAD viewport checks (WebKit, iPad Pro 11" landscape + portrait).
// Screenshots land in e2e/screenshots/<project>-<state>.png.
// ---------------------------------------------------------------------------

const TODAY = "2026-09-21";

const STRENGTH_PLAN = {
  plan_id: 101,
  plan_date: TODAY,
  phase: 1,
  week_num: 1,
  session_type: "strength_a",
  target_rpe: 6,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    display_name: "Office Strength A",
    location: "office gym",
    rounds: 2,
    warmup: "5 min elliptical, easy",
    cooldown: "5 min Stretch Trainer",
    rest_between_rounds_sec: 90,
    equipment: ["leg press", "DBs", "flat bench", "pulldown", "leg curl", "functional trainer (rope)", "captain's chair"],
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60, notes: "2×10-12; log seat + pin setting" },
      { name: "DB bench press", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60, notes: "2×8-12" },
      { name: "Lat pulldown", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60 },
      { name: "Seated leg curl", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60 },
      { name: "Cable face pull (rope)", format: "reps", target_reps: 15, target_load_lbs: null, rest_after_sec: 60 },
      { name: "Captain's chair knee raise", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60 },
    ],
  },
};

const Z2_PLAN = {
  plan_id: 102,
  plan_date: TODAY,
  phase: 1,
  week_num: 1,
  session_type: "cardio_z2",
  target_rpe: 4,
  est_duration_min: 20,
  is_skipped: false,
  blocks: {
    type: "steady",
    display_name: "Zone 2 Cardio",
    location: "office gym",
    duration_min: 20,
    intensity: "Zone 2",
    equipment: ["treadmill", "elliptical", "recumbent bike", "upright bike"],
    setup_notes: ["treadmill incline walk, elliptical, recumbent, or upright bike — conversational pace"],
  },
};

const MOBILITY_PLAN = {
  plan_id: 103,
  plan_date: TODAY,
  phase: 1,
  week_num: 1,
  session_type: "rest_mobility",
  target_rpe: 3,
  est_duration_min: 20,
  is_skipped: false,
  blocks: {
    type: "mobility",
    display_name: "Rest / Mobility",
    notes: "20 min mobility (mat or Stretch Trainer) or full rest",
    intensity: "gentle",
    duration_min: 20,
  },
};

function statusFor(summary: { plan_id: number | null; session_type: string | null; exists: boolean }) {
  return {
    today: TODAY,
    window_start: "2026-09-15",
    window_end: TODAY,
    today_summary: { ...summary, is_skipped: false, is_logged: false },
    banner: { phase: 1, week_num: 1, phase_name: "Office ramp", as_of_date: TODAY },
    day_strip: [],
    most_recent_session: null,
    same_type_history: [],
    rpe_trend: [],
    weight_trend: [
      { date: "2026-09-10", value: 271.4 },
      { date: "2026-09-14", value: 270.2 },
      { date: "2026-09-18", value: 269.6 },
    ],
  };
}

const SESSIONS = {
  today: TODAY,
  window_start: "2026-09-15",
  window_end: TODAY,
  days: [
    {
      plan_date: "2026-09-17", plan_id: 90, session_type: "strength_a", display_name: "Office Strength A",
      phase: 1, week_num: 1, target_rpe: 6, target_hr_zone: 3, is_skipped: false, is_today: false,
      planned_set_count: 12, logged_set_count: 12, avg_set_rpe: 6.3, hr_avg: null, hr_peak: null,
      total_work_sec: 1860, session_summary: { rpe_actual: 6, notes: null, logged_at: "2026-09-17T12:00:00Z" },
      sets: [], outliers: { high_rpe_sets: [], incomplete: false, incomplete_logged: 0, incomplete_planned: 0, pain_notes: [] },
    },
    {
      plan_date: TODAY, plan_id: 103, session_type: "rest_mobility", display_name: "Rest / Mobility",
      phase: 1, week_num: 1, target_rpe: null, target_hr_zone: null, is_skipped: false, is_today: true,
      planned_set_count: 1, logged_set_count: 0, avg_set_rpe: null, hr_avg: null, hr_peak: null,
      total_work_sec: 0, session_summary: null, sets: [],
      outliers: { high_rpe_sets: [], incomplete: false, incomplete_logged: 0, incomplete_planned: 0, pain_notes: [] },
    },
  ],
};

interface MockOpts {
  plan: typeof STRENGTH_PLAN | typeof Z2_PLAN | typeof MOBILITY_PLAN | null;
  status: ReturnType<typeof statusFor>;
}

async function mockApi(page: Page, { plan, status }: MockOpts): Promise<unknown[]> {
  const posted: unknown[] = [];
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) {
      return plan
        ? route.fulfill({ json: plan })
        : route.fulfill({ status: 404, json: { error: "no_plan", fallback: "rest day or check Mattermost" } });
    }
    if (path.endsWith("/status")) return route.fulfill({ json: status });
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: plan?.plan_id ?? null, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/last_logged")) {
      return route.fulfill({
        json: {
          by_exercise: {
            "Leg press": {
              exercise: "Leg press", plan_date: "2026-09-17", weight_lbs: 170, reps_done: 12, rpe_actual: 6,
              duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, notes: "setting=4",
            },
          },
        },
      });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: SESSIONS });
    if (path.endsWith("/overview")) return route.fulfill({ json: overview });
    if (path.endsWith("/log")) {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { plan_id: plan?.plan_id ?? null, inserted: 1, rows: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  return posted;
}

async function shot(page: Page, name: string) {
  const project = test.info().project.name;
  await page.screenshot({ path: `e2e/screenshots/${project}-${name}.png` });
}

/** No horizontal page overflow, and the root actually painted something. */
async function expectSaneLayout(page: Page) {
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    rootChildren: document.getElementById("root")?.childElementCount ?? 0,
  }));
  expect(m.rootChildren).toBeGreaterThan(0);
  expect(m.scrollW).toBeLessThanOrEqual(m.innerW);
}

/** Every visible button (and nav link) meets the 56 px touch-target floor. */
async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden";
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((b) => b.w < 56 || b.h < 56),
  );
  expect(small).toEqual([]);
}

/** Log mode must not clip its top: the rest timer and the first stepper start
 * inside the scroll area (overflow scrolls down, never off the top). */
async function expectRestLogNotClipped(page: Page) {
  const r = await page.evaluate(() => {
    const body = document.querySelector(".workout-pane-body")!.getBoundingClientRect();
    const timer = document.querySelector(".restlog-timer")!.getBoundingClientRect();
    const stepper = document.querySelector(".stepper-row")!.getBoundingClientRect();
    return { bodyTop: body.top, timerTop: timer.top, stepperTop: stepper.top, bodyBottom: body.bottom };
  });
  expect(r.timerTop).toBeGreaterThanOrEqual(r.bodyTop - 1);
  expect(r.stepperTop).toBeGreaterThanOrEqual(r.bodyTop - 1);
  expect(r.stepperTop).toBeLessThan(r.bodyBottom);
}

/** Nothing on screen can raise the iOS keyboard. */
async function expectNoKeyboardTriggers(page: Page) {
  const triggers = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select, [contenteditable]"))
      .filter((el) => el.getAttribute("inputmode") !== "none").length,
  );
  expect(triggers).toBe(0);
}

test.describe("strength day", () => {
  test("active set (glance) → rest log with keypad → log set lands with setting", async ({ page }) => {
    const posted = await mockApi(page, { plan: STRENGTH_PLAN, status: statusFor({ plan_id: 101, session_type: "strength_a", exists: true }) });
    await page.goto("/today");
    await expect(page.getByRole("heading").or(page.getByText("Office Strength A").first())).toBeVisible();
    await shot(page, "0-setup");

    await page.getByRole("button", { name: "Start Workout" }).tap();
    await page.getByRole("button", { name: "Skip to next" }).tap();   // past warmup
    await expect(page.locator(".glance-name")).toHaveText("Leg press");
    await expect(page.locator(".glance-set")).toHaveText("Set 1 of 2");
    // GD-DISTANCE: the target now lives in three tiles (it replaced
    // GD-STRENGTH-CUES's one-line target block). LAST is /last_logged's set.
    await expect(page.getByTestId("tile-reps").locator(".stile-num")).toHaveText("12");
    await expect(page.getByTestId("tile-rpe").locator(".stile-num")).toHaveText("6");
    await expect(page.getByTestId("tile-rpe-sub")).toHaveText("stop with ~4 reps left");
    await expect(page.getByTestId("tile-last").locator(".stile-num")).toHaveText("170lb");
    await expect(page.getByTestId("glance-target-block")).toHaveCount(0);
    await expectSaneLayout(page);
    await expectTouchTargets(page);
    await expectNoKeyboardTriggers(page);
    await shot(page, "1-strength-active-set");

    await page.getByRole("button", { name: "Set done" }).tap();
    await expect(page.getByTestId("inline-logger")).toBeVisible();
    // Week 1, set 1: Machine setup is open, pre-filled from last session
    // (a legacy "setting=4" reads back as the seat).
    await expect(page.getByRole("button", { name: /^Seat 4, tap to enter$/ })).toBeVisible();
    await expect(page.getByText(/numbered positions you used/)).toBeVisible();
    await expectRestLogNotClipped(page);
    await expectTouchTargets(page);
    await expectNoKeyboardTriggers(page);

    await page.getByRole("button", { name: /^Weight 170 lb, tap to enter$/ }).tap();
    const pad = page.getByRole("dialog", { name: "Weight keypad" });
    await expect(pad).toBeVisible();
    for (const d of ["1", "8", "0"]) await pad.getByRole("button", { name: `Digit ${d}` }).tap();
    await expectTouchTargets(page);
    await expectNoKeyboardTriggers(page);
    await expectSaneLayout(page);
    await shot(page, "2-rest-log-keypad");

    await pad.getByRole("button", { name: "Done" }).tap();
    await page.getByRole("button", { name: "RPE 7", exact: true }).tap();
    await page.getByRole("button", { name: "Log Leg press set 1" }).tap();
    await expect(page.locator(".restlog-done")).toBeVisible();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      plan_id: 101, exercise: "Leg press", log_type: "strength_set",
      sets: [{ set_num: 1, weight_lbs: 180, reps_done: 12, rpe_actual: 7, is_skipped: false, notes: "seat=4" }],
    });
    await shot(page, "3-rest-logged");
  });

  test("swipe left on the active pane advances a step", async ({ page }) => {
    await mockApi(page, { plan: STRENGTH_PLAN, status: statusFor({ plan_id: 101, session_type: "strength_a", exists: true }) });
    await page.goto("/today");
    await page.getByRole("button", { name: "Start Workout" }).tap();
    const pane = page.locator(".workout-pane");
    const box = (await pane.boundingBox())!;
    const y = box.y + box.height * 0.3;
    await pane.dispatchEvent("pointerdown", { pointerId: 7, clientX: box.x + box.width * 0.8, clientY: y, button: 0 });
    await pane.dispatchEvent("pointerup", { pointerId: 7, clientX: box.x + box.width * 0.2, clientY: y + 5, button: 0 });
    await expect(page.locator(".glance-name")).toHaveText("Leg press");
  });

  test("Split View width (600px) keeps the layout intact", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 834 });
    await mockApi(page, { plan: STRENGTH_PLAN, status: statusFor({ plan_id: 101, session_type: "strength_a", exists: true }) });
    await page.goto("/today");
    await page.getByRole("button", { name: "Start Workout" }).tap();
    await page.getByRole("button", { name: "Skip to next" }).tap();
    await page.getByRole("button", { name: "Set done" }).tap();
    await expect(page.getByTestId("inline-logger")).toBeVisible();
    await expectRestLogNotClipped(page);
    await expectSaneLayout(page);
    await shot(page, "9-splitview-600-rest-log");
  });
});

test("cardio_z2 steady (no exercises array) renders the timer, not a black screen", async ({ page }) => {
  await mockApi(page, { plan: Z2_PLAN, status: statusFor({ plan_id: 102, session_type: "cardio_z2", exists: true }) });
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await expect(page.locator(".glance-name")).toHaveText("Zone 2 Cardio");
  await expect(page.locator(".glance-time")).toHaveText(/^(20:00|19:5\d)$/);
  await expectSaneLayout(page);
  await expectTouchTargets(page);
  await shot(page, "4-cardio-z2");
});

test("rest_mobility: redirects to Status; Today shows the rest-day screen", async ({ page }) => {
  await mockApi(page, { plan: MOBILITY_PLAN, status: statusFor({ plan_id: 103, session_type: "rest_mobility", exists: true }) });
  await page.goto("/today");
  await expect(page).toHaveURL(/\/status$/);
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expectSaneLayout(page);
  await expectTouchTargets(page);
  await shot(page, "5-rest-mobility-status");

  await page.getByRole("link", { name: "Workout" }).tap();
  await expect(page.getByText("See you tomorrow.")).toBeVisible();
  await expectSaneLayout(page);
  await shot(page, "6-rest-mobility-today");
});

test("no plan today: Status, then the empty Today screen", async ({ page }) => {
  await mockApi(page, { plan: null, status: statusFor({ plan_id: null, session_type: null, exists: false }) });
  await page.goto("/today");
  await expect(page).toHaveURL(/\/status$/);
  await shot(page, "7-no-plan-status");

  await page.getByRole("link", { name: "Workout" }).tap();
  await expect(page.getByText("No workout today")).toBeVisible();
  await expectSaneLayout(page);
  await expectTouchTargets(page);
  await shot(page, "8-no-plan-today");
});
