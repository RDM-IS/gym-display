import { expect, test, type Page } from "@playwright/test";
import office from "../tests/fixtures/recovery-flow-office.json" with { type: "json" };

// GD-NAV — one bottom bar on every Setup-level view (iPad WebKit, both
// orientations): no dead ends, Start only on Today, 56 px targets, fixed at
// the bottom, and the last item of every list scrolls clear of it.

const TODAY = "2026-09-21";

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const EXERCISES = [
  "DB Romanian deadlift", "Pec fly", "Single-arm cable row", "Seated DB shoulder press",
  "Calf press", "Ab machine crunch",
].map((name) => ({ name, format: "reps", target_reps: 12, notes: "2×8-12", rest_after_sec: 60 }));

const STRENGTH = {
  plan_id: 110, plan_date: TODAY, phase: 1, week_num: 1, session_type: "strength_c",
  target_rpe: 6, est_duration_min: 40, is_skipped: false,
  blocks: {
    type: "circuit", display_name: "Office Strength C", location: "office gym", rounds: 2,
    warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer",
    equipment: ["DBs", "pec fly", "functional trainer", "adjustable bench", "calf press", "ab machine"],
    setup_notes: ["Weeks 1-2: finding weights — stop 3-4 reps shy of failure."],
    exercises: EXERCISES,
  },
};

const FLOW = { ...office, plan_date: TODAY, session_type: "rest_mobility" };

function planDay(date: string, i: number, weekNum: number) {
  const past = date < TODAY;
  return {
    plan_id: 500 + i, plan_date: date, session_type: "strength_c", display_name: `Session ${i + 1}`,
    phase: 1, week_num: weekNum, target_rpe: 6, est_duration_min: 40, location: "office gym",
    is_skipped: false, adjusted: false,
    status: past ? "done" : date === TODAY ? "today" : "upcoming",
    blocks: STRENGTH.blocks,
    logged: past ? [{ exercise: "Pec fly", log_type: "strength_set", sets: 2, reps: [12, 12],
                      top_weight_lbs: 70, duration_sec: null, skipped: 0 }] : [],
    summary_notes: null,
  };
}

async function mockApi(page: Page, plan: typeof STRENGTH | typeof FLOW) {
  await page.route("**/api/health/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/plan")) {
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      const n = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
      const weekNum = from >= "2026-09-23" ? 2 : 1;
      return route.fulfill({ json: {
        today: TODAY, timezone: "America/Chicago", range_from: from, range_to: to,
        days: Array.from({ length: n }, (_, i) => planDay(addDays(from, i), i, weekNum)),
      } });
    }
    if (path.endsWith("/today")) return route.fulfill({ json: plan });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: TODAY, window_start: "2026-09-16", window_end: "2026-09-26",
        today_summary: { plan_id: plan.plan_id, session_type: plan.session_type, is_skipped: false,
                         is_logged: false, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: plan.plan_id, exercises: [], has_session_summary: false } });
    }
    return route.fulfill({ json: { by_exercise: {}, days: [] } });
  });
}

const bar = (page: Page) => page.getByTestId("bottom-bar");

async function barLabels(page: Page): Promise<string[]> {
  return (await bar(page).getByRole("button").allTextContents()).map((t) => t.trim());
}

async function tapBar(page: Page, name: string) {
  await bar(page).getByRole("button", { name, exact: true }).tap();
}

/** Every visible control meets 56 px; the bar is pinned to the bottom edge. */
async function expectChrome(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ r }) => r.width < 56 || r.height < 56)
      .map(({ el, r }) => `${el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small).toEqual([]);
  const box = (await bar(page).boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(Math.round(box.y + box.height)).toBe(vh);
  const n = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select, [contenteditable]"))
      .filter((el) => el.getAttribute("inputmode") !== "none").length);
  expect(n).toBe(0);
  // One "Today" control at most: the top tab is Workout.
  await expect(page.getByRole("link", { name: "Today" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Workout" })).toBeVisible();
}

/** Right-group buttons sit at the same height and size on every view. */
async function barGeometry(page: Page) {
  const boxes = await bar(page).locator(".bottom-bar-btn").evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { y: r.y, h: r.height, right: r.right }; }));
  return { y: boxes[0].y, h: boxes[0].h, lastRight: boxes.at(-1)!.right };
}

/** Scroll `scroller` to the end; `last` must end above the bar. */
async function expectLastClearsBar(page: Page, scroller: string, last: string) {
  await page.locator(scroller).first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(50);
  const item = (await page.locator(last).last().boundingBox())!;
  const b = (await bar(page).boundingBox())!;
  expect(item.y + item.height).toBeLessThanOrEqual(b.y + 0.5);
}

test("Today → Tomorrow → Week → a day → Week → Today, no dead ends", async ({ page }) => {
  await mockApi(page, STRENGTH);
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00-05:00`) });
  await page.goto("/today");

  // Today
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
  expect(await barLabels(page)).toEqual(["Start Workout", "Tomorrow", "Week"]);
  await expectChrome(page);
  const geo = await barGeometry(page);
  await shot(page, "nav-0-today");

  // Tomorrow — title where the back button was, no Start.
  await tapBar(page, "Tomorrow");
  await expect(page.getByTestId("peek-tomorrow")).toBeVisible();
  expect(await barLabels(page)).toEqual(["Today", "Week"]);
  await expect(page.getByRole("button", { name: /start/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "‹ Today" })).toHaveCount(0);
  const title = (await page.locator(".peek-title").boundingBox())!;
  expect(title.x).toBeLessThan(60);
  expect(title.y).toBeLessThan(60);
  await expect(page.locator(".plan-detail .meta").first()).toHaveText("Tue 9/22 · Upcoming");
  await expectChrome(page);
  expect(await barGeometry(page)).toEqual(geo);
  await shot(page, "nav-1-tomorrow");

  // Week
  await tapBar(page, "Week");
  await expect(page.getByTestId("peek-week")).toBeVisible();
  expect(await barLabels(page)).toEqual(["Today", "Tomorrow"]);
  await expectChrome(page);
  expect(await barGeometry(page)).toEqual(geo);
  await page.getByRole("button", { name: "Next week" }).tap();
  await expect(page.getByTestId("week-title")).toContainText("Phase 1 · Week 2");
  await shot(page, "nav-2-week");

  // A day from week 2
  await page.getByTestId("week-row-2026-09-24").tap();
  await expect(page.getByTestId("peek-day")).toBeVisible();
  await expect(page.locator(".peek-title")).toHaveText("Thu 9/24");
  expect(await barLabels(page)).toEqual(["Today", "Week"]);
  await expect(page.getByRole("button", { name: /start/i })).toHaveCount(0);
  await expectChrome(page);
  expect(await barGeometry(page)).toEqual(geo);
  await shot(page, "nav-3-day");

  // Week — back at the same program week.
  await tapBar(page, "Week");
  await expect(page.getByTestId("peek-week")).toBeVisible();
  await expect(page.getByTestId("week-title")).toContainText("Phase 1 · Week 2");
  await expect(page.getByTestId("week-title")).toContainText("Wed 9/23 – Tue 9/29");

  // Today
  await tapBar(page, "Today");
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
  expect(await barLabels(page)).toEqual(["Start Workout", "Tomorrow", "Week"]);

  // The top Workout tab also leaves a view.
  await tapBar(page, "Week");
  await page.getByRole("link", { name: "Status" }).tap();
  await expect(page).toHaveURL(/\/status$/);
  await expect(bar(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Workout" }).tap();
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
});

test("the last item of every list clears the bar", async ({ page }) => {
  await mockApi(page, STRENGTH);
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00-05:00`) });
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
  await expectLastClearsBar(page, ".setup-scroll", ".setup-scroll .section");

  await tapBar(page, "Tomorrow");
  await expect(page.getByTestId("plan-detail")).toBeVisible();
  await expectLastClearsBar(page, ".peek-body", ".plan-detail-foot");

  await tapBar(page, "Week");
  await expect(page.getByTestId("week-row-2026-09-22")).toBeVisible();
  await expectLastClearsBar(page, ".week-list", ".week-list li");

  await page.getByTestId("week-row-2026-09-16").tap();
  await expect(page.getByTestId("plan-detail-logged")).toBeVisible();
  await expectLastClearsBar(page, ".peek-body", ".plan-detail-logged li");
});

test("flow day: the pose list and hint clear the bar; Start only on Today", async ({ page }) => {
  await mockApi(page, FLOW);
  await page.goto("/today");
  await expect(page.getByTestId("flow-ready")).toBeVisible();
  expect(await barLabels(page)).toEqual(["Start", "Tomorrow", "Week"]);
  await expectChrome(page);
  await expectLastClearsBar(page, ".flow-ready", ".flow-list li");
  await expectLastClearsBar(page, ".flow-ready", ".flow-ready > .desc");
  await shot(page, "nav-4-flow-ready-bottom");

  // Bar hidden while the flow runs.
  await bar(page).getByRole("button", { name: "Start", exact: true }).tap();
  await expect(page.getByTestId("flow-run")).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("bar hidden during an active workout", async ({ page }) => {
  await mockApi(page, STRENGTH);
  await page.goto("/today");
  await bar(page).getByRole("button", { name: "Start Workout" }).tap();
  await expect(page.getByRole("button", { name: "Skip to next" })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}
