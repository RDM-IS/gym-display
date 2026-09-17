import { expect, test } from "@playwright/test";

// PAIN-1: the in-session Pain chip on a real iPad-sized WebKit page — no
// keyboard, 56 px targets, and the posted set carries `pain=shoulder:2`.

const TODAY = "2026-09-21";

const PLAN = {
  plan_id: 106,
  plan_date: TODAY,
  phase: 1,
  week_num: 1,
  session_type: "strength_c",
  target_rpe: 6,
  est_duration_min: 40,
  is_skipped: false,
  blocks: {
    type: "circuit",
    display_name: "Office Strength C",
    location: "office gym",
    rounds: 2,
    warmup: "5 min elliptical, easy",
    cooldown: "5 min Stretch Trainer",
    rest_between_rounds_sec: 90,
    equipment: ["DBs", "adjustable bench"],
    exercises: [
      { name: "Seated DB shoulder press", format: "reps", target_reps: 12, target_load_lbs: 20,
        load_from: 25, rest_after_sec: 60, notes: "2×8-12" },
      { name: "Pec fly", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60,
        notes: "2×10-12; go lighter than last time", load_note: "go lighter than last time" },
    ],
    adjustment: {
      rules_fired: ["pain_lighter"],
      eased: ["Seated DB shoulder press", "Pec fly"],
      summary: ["Pain shoulder 2/5 → seated DB shoulder press 20 lb (last 25); pec fly: go lighter than last time."],
    },
  },
};

const STATUS = {
  today: TODAY, window_start: "2026-09-16", window_end: "2026-09-26",
  today_summary: { plan_id: 106, session_type: "strength_c", is_skipped: false, is_logged: false, exists: true },
  banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
  day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
};

const SESSIONS = {
  days: [{
    plan_date: TODAY, plan_id: 106, session_type: "strength_c", display_name: "Office Strength C",
    phase: 1, week_num: 1, target_rpe: 6, target_hr_zone: 3, is_skipped: false, is_today: true,
    planned_set_count: 4, logged_set_count: 1, avg_set_rpe: 6, hr_avg: null, hr_peak: null,
    total_work_sec: 0, session_summary: null, sets: [],
    outliers: { high_rpe_sets: [], incomplete: true, incomplete_logged: 1, incomplete_planned: 4,
                pain_notes: ["pain=shoulder:2"] },
  }],
};

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

test("pain chip: region + rating, no keyboard, posted note, Status still flags it", async ({ page }) => {
  const posted: Array<{ sets: Array<{ notes: string | null; weight_lbs: number | null }> }> = [];
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: PLAN });
    if (path.endsWith("/status")) return route.fulfill({ json: STATUS });
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: 106, exercises: [], has_session_summary: false } });
    if (path.endsWith("/last_logged")) {
      return route.fulfill({ json: { by_exercise: {
        "Seated DB shoulder press": { exercise: "Seated DB shoulder press", plan_date: "2026-09-14",
          weight_lbs: 25, reps_done: 10, rpe_actual: 7, duration_sec: null, distance_m: null,
          hr_avg: null, hr_peak: null, notes: null },
      } } });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: SESSIONS });
    if (path.endsWith("/log")) {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { plan_id: 106, inserted: 1, rows: [] } });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto("/today");
  await expect(page.getByRole("button", { name: /Adjusted: pain shoulder 2\/5/ })).toBeVisible();
  await expect(page.getByText("20 lb (last 25)")).toBeVisible();
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await page.getByRole("button", { name: "Set done" }).tap();

  const logger = page.getByTestId("inline-logger");
  await expect(logger).toBeVisible();
  // The lowered target wins over last session's 25 lb.
  await expect(logger.getByRole("button", { name: /^Weight 20 lb, tap to enter$/ })).toBeVisible();
  await expect(logger).toContainText("(last 25 lb)");

  await logger.getByTestId("pain-chip").tap();
  const picker = logger.getByTestId("pain-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "shoulder", exact: true }).tap();
  await picker.scrollIntoViewIfNeeded();

  const noKeyboard = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select, [contenteditable]"))
      .filter((el) => el.getAttribute("inputmode") !== "none").length);
  expect(noKeyboard).toBe(0);
  const small = await picker.evaluate((root) =>
    Array.from(root.querySelectorAll("button"))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width < 56 || r.height < 56).length);
  expect(small).toBe(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await shot(page, "pain-picker");

  await picker.getByRole("button", { name: "Pain 2", exact: true }).tap();
  await expect(picker).toBeHidden();
  await expect(logger.getByRole("button", { name: "Remove pain shoulder 2" })).toBeVisible();
  await logger.scrollIntoViewIfNeeded();
  await shot(page, "pain-chip-set");

  await logger.getByRole("button", { name: "Log Seated DB shoulder press set 1" }).tap();
  await expect(page.locator(".restlog-done")).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    plan_id: 106, exercise: "Seated DB shoulder press", log_type: "strength_set",
    sets: [{ set_num: 1, weight_lbs: 20, is_skipped: false, notes: "pain=shoulder:2" }],
  });

  await page.goto("/status");
  const row = page.locator(".outlier-row", { hasText: "pain=shoulder:2" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Pain note");
  await row.scrollIntoViewIfNeeded();
  await shot(page, "pain-status-outlier");
});

test("check-in day off renders as a rest day with the adjustment", async ({ page }) => {
  const dayOff = {
    ...PLAN, session_type: "rest_mobility", target_rpe: null, est_duration_min: 0,
    blocks: {
      type: "mobility", display_name: "Day off", intensity: "none", duration_min: 0,
      notes: "Day off — no training.",
      adjustment: { rules_fired: ["pain_day_off"], summary: ["Pain shoulder 4/5 → day off."] },
    },
  };
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: dayOff });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: { ...STATUS, today_summary: {
        plan_id: 106, session_type: "rest_mobility", is_skipped: false, is_logged: false, exists: true } } });
    }
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: 106, exercises: [], has_session_summary: false } });
    if (path.endsWith("/sessions")) return route.fulfill({ json: { days: [] } });
    return route.fulfill({ json: { by_exercise: {} } });
  });
  // Like any rest day, Today redirects to Status first.
  await page.goto("/today");
  await expect(page).toHaveURL(/\/status$/);
  await page.getByRole("link", { name: "Workout" }).tap();
  await expect(page.getByText("No training today.")).toBeVisible();
  await expect(page.getByText("Day off", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Adjusted: pain shoulder 4\/5/ })).toBeVisible();
  await shot(page, "pain-day-off");
});
