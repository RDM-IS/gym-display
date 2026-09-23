import { expect, test, type Page } from "@playwright/test";
import overview from "../tests/fixtures/overview.json" with { type: "json" };

// ---------------------------------------------------------------------------
// GD-REST-TILES (Ryan, 2026-09-23) — the three tiles in the rest screen's
// upper right, for the exercise the rest leads into. WebKit at the real iPad
// Pro 11" viewport, both orientations (the projects in playwright.config).
//
// What this pins: the tiles are there and hold the NEXT exercise; a first-time
// exercise says "first time"; the rest timer stays dominant; nothing shifts at
// the rest → set boundary; and the final rest shows nothing at all.
// ---------------------------------------------------------------------------

const TODAY = "2026-09-23";

const PLAN = {
  plan_id: 101, plan_date: TODAY, phase: 1, week_num: 1, session_type: "strength_a",
  target_rpe: 6, est_duration_min: 40, is_skipped: false,
  blocks: {
    type: "circuit", display_name: "Office Strength A", location: "office gym", rounds: 2,
    warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer",
    rest_between_rounds_sec: 90, equipment: ["leg press"],
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, target_load_lbs: null,
        rest_after_sec: 60, notes: "2×10-12; log seat + pin setting" },
      { name: "DB bench press", format: "reps", target_reps: 10, target_load_lbs: null,
        rest_after_sec: 60 },
    ],
  },
};

// Leg press has history; DB bench press has none — it must read "first time".
const LAST_SET = {
  exercise: "Leg press", plan_date: "2026-09-18", weight_lbs: 175, reps_done: 12, rpe_actual: 7,
  duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, notes: null,
};

const STATUS = {
  today: TODAY, window_start: "2026-09-17", window_end: TODAY,
  today_summary: { plan_id: 101, session_type: "strength_a", exists: true, is_skipped: false, is_logged: false },
  banner: { phase: 1, week_num: 1, phase_name: "Office ramp", as_of_date: TODAY },
  day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
};

async function mockApi(page: Page) {
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: PLAN });
    if (path.endsWith("/status")) return route.fulfill({ json: STATUS });
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: 101, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/last_logged")) {
      return route.fulfill({ json: { by_exercise: { "Leg press": LAST_SET } } });
    }
    if (path.endsWith("/sessions")) {
      return route.fulfill({ json: { today: TODAY, window_start: "2026-09-17", window_end: TODAY, days: [] } });
    }
    if (path.endsWith("/overview")) return route.fulfill({ json: overview });
    if (path.endsWith("/log")) return route.fulfill({ json: { plan_id: 101, inserted: 1, rows: [] } });
    return route.fulfill({ status: 404, json: {} });
  });
}

async function shot(page: Page, name: string) {
  await page.waitForFunction(() => {
    const el = document.querySelector(".workout");
    const anims = el?.getAnimations ? el.getAnimations() : [];
    return anims.every((a) => a.playState !== "running");
  });
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

/** Start, skip the warmup, finish the first set → the logging rest. */
async function toFirstRest(page: Page) {
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await expect(page.getByTestId("glance-strength")).toBeVisible();
  await page.getByRole("button", { name: "Set done" }).tap();
  await expect(page.getByTestId("upnext-tiles")).toBeVisible();
}

test("the rest screen carries the next exercise's tiles", async ({ page }) => {
  await mockApi(page);
  await toFirstRest(page);

  // the name is folded into the tiles, not repeated beside the timer
  await expect(page.getByTestId("upnext-name")).toHaveText("Next: DB bench press");
  await expect(page.locator(".restlog-next")).toHaveCount(0);

  // the NEXT exercise's numbers: 10 reps, the session cap, and no history yet
  await expect(page.getByTestId("tile-reps").locator(".stile-num")).toHaveText("10");
  await expect(page.getByTestId("tile-rpe").locator(".stile-num")).toHaveText("6");
  await expect(page.getByTestId("tile-rpe-sub")).toHaveText("stop with ~4 reps left");
  await expect(page.getByTestId("tile-last-sub")).toHaveText("first time");
  await expect(page.getByTestId("strength-tiles-compact")).toBeVisible();

  await shot(page, "rest-tiles-1-first-rest");
});

test("the rest timer stays dominant", async ({ page }) => {
  await mockApi(page);
  await toFirstRest(page);

  const timer = await page.locator(".restlog-time").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const tile = await page.getByTestId("tile-reps").locator(".stile-num")
    .evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  console.log(`[${test.info().project.name}] rest timer ${timer}px vs tile numeral ${tile}px`);
  expect(timer).toBeGreaterThan(tile);

  // …and the tiles sit in the upper right, beside or under the timer — never
  // over it, and never wider than the pane.
  const tiles = (await page.getByTestId("upnext-tiles").boundingBox())!;
  const time = (await page.locator(".restlog-time").boundingBox())!;
  const pane = (await page.locator(".workout-pane").boundingBox())!;
  const besideOrBelow = tiles.x >= time.x + time.width - 1 || tiles.y >= time.y + time.height - 1;
  expect(besideOrBelow).toBe(true);
  expect(tiles.width).toBeLessThanOrEqual(pane.width);
});

test("nothing shifts at the rest → set boundary", async ({ page }) => {
  await mockApi(page);

  // The set screen reached WITHOUT ever showing rest tiles (straight from the
  // warmup) …
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await expect(page.getByTestId("glance-strength")).toBeVisible();
  const fromWarmup = (await page.getByTestId("strength-tiles").boundingBox())!;

  // … and the same screen reached THROUGH a rest that showed them. The tiles
  // must land in exactly the same place: the compact set is a different
  // element in a different container and must not disturb this one.
  await page.getByRole("button", { name: "Set done" }).tap();
  await expect(page.getByTestId("upnext-tiles")).toBeVisible();
  const restTimer = (await page.locator(".restlog-time").boundingBox())!;
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await expect(page.getByTestId("glance-strength")).toBeVisible();
  const afterRest = (await page.getByTestId("strength-tiles").boundingBox())!;

  for (const k of ["x", "y", "width", "height"] as const) {
    expect(Math.round(afterRest[k]), k).toBe(Math.round(fromWarmup[k]));
  }
  // the compact tiles were genuinely smaller than the set screen's
  expect(afterRest.width).toBeGreaterThan(restTimer.width * 0.5);
  await shot(page, "rest-tiles-2-set-after-rest");
});

test("the rest screen does not reflow when the tiles' values arrive", async ({ page }) => {
  await mockApi(page);
  await toFirstRest(page);
  const before = (await page.locator(".restlog-time").boundingBox())!;
  const tilesBefore = (await page.getByTestId("upnext-tiles").boundingBox())!;

  // every line of a tile always renders (an empty line is a non-breaking
  // space), so a value changing cannot move anything
  await page.getByTestId("tile-last").evaluate((el) => {
    const num = el.querySelector(".stile-num");
    if (num) num.textContent = "175lb";
  });
  const after = (await page.locator(".restlog-time").boundingBox())!;
  const tilesAfter = (await page.getByTestId("upnext-tiles").boundingBox())!;
  expect(after).toEqual(before);
  expect(tilesAfter.y).toBe(tilesBefore.y);
  expect(tilesAfter.height).toBe(tilesBefore.height);
});

test("between rounds it shows the next round's first exercise", async ({ page }) => {
  await mockApi(page);
  await toFirstRest(page);                                        // rest after Leg press
  await page.getByRole("button", { name: "Skip to next" }).tap(); // DB bench press
  await expect(page.getByTestId("glance-strength")).toBeVisible();
  await page.getByRole("button", { name: "Set done" }).tap();     // the round break

  // The round break still renders the LOGGING rest here — the set just done can
  // still be entered — so the tiles ride in its upper right, naming the first
  // exercise of the round that follows.
  await expect(page.locator(".restlog-label")).toHaveText(/Rest/);
  await expect(page.getByTestId("upnext-name")).toHaveText("Next: Leg press");
  // Leg press has 9/18 history and nothing logged today, so it reads the
  // previous session and says plain "Last".
  await expect(page.getByTestId("tile-last").locator(".stile-num")).toHaveText("175lb");
  await expect(page.getByTestId("tile-last-label")).toHaveText("Last");
  await shot(page, "rest-tiles-3-between-rounds");
});

test("the FINAL rest shows nothing rather than something stale", async ({ page }) => {
  await mockApi(page);
  await toFirstRest(page);
  // walk to the end: round 1 DB bench, round break, round 2 both exercises
  for (const _ of [0, 1, 2, 3, 4]) {
    await page.getByRole("button", { name: "Skip to next" }).tap();
  }
  // the last rest of the session leads to the cooldown, not an exercise
  const tiles = page.getByTestId("upnext-tiles");
  if (await tiles.count()) {
    await expect(tiles).toBeHidden();
  }
  await expect(page.getByTestId("upnext-tiles")).toHaveCount(0);
  await shot(page, "rest-tiles-4-final-rest");
});
