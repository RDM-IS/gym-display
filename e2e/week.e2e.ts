import { expect, test, type Page } from "@playwright/test";
import office from "../tests/fixtures/recovery-flow-office.json" with { type: "json" };

// GD-WEEK — read-only Tomorrow / Week on iPad WebKit (landscape + portrait).

const TODAY = "2026-09-21";   // Mon, program week 1 (Wed 9/16 – Tue 9/22)

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function circuit(name: string, extra: Record<string, unknown> = {}) {
  return {
    type: "circuit", display_name: name, location: "office gym", rounds: 2,
    warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer",
    exercises: [
      { name: "DB goblet squat", format: "reps", target_reps: 12, notes: "2×8-12" },
      { name: "Seated cable row", format: "reps", target_reps: 12, notes: "2×10-12" },
      { name: "Incline DB press", format: "reps", target_reps: 12, notes: "2×8-12",
        target_load_lbs: 20, load_from: 25 },
    ],
    ...extra,
  };
}

const STRENGTH_TODAY = {
  plan_id: 110, plan_date: TODAY, phase: 1, week_num: 1, session_type: "strength_c",
  target_rpe: 6, est_duration_min: 40, is_skipped: false, blocks: circuit("Office Strength C"),
};

function planDay(date: string, over: Record<string, unknown>) {
  return {
    plan_id: 100, plan_date: date, session_type: "strength_b", display_name: "Office Strength B",
    phase: 1, week_num: 1, target_rpe: 6, est_duration_min: 45, location: "office gym",
    is_skipped: false, adjusted: false, status: "upcoming", logged: [], summary_notes: null,
    blocks: circuit("Office Strength B"),
    ...over,
  };
}

/** Week 1 (9/16–9/22): done, done flow, partial + adjusted, missed rest?, … */
function week(from: string) {
  const w = from >= "2026-10-28" ? 7 : from >= "2026-09-23" ? 2 : 1;
  const rows = [
    { session_type: "strength_a", display_name: "Office Strength A", est_duration_min: 40, status: "done",
      logged: [
        { exercise: "Leg press", log_type: "strength_set", sets: 2, reps: [12, 11], top_weight_lbs: 180,
          duration_sec: null, skipped: 0 },
        { exercise: "DB bench press", log_type: "strength_set", sets: 2, reps: [10, 10], top_weight_lbs: 30,
          duration_sec: null, skipped: 0 },
      ], summary_notes: null },
    { session_type: "rest_mobility", display_name: "Recovery Flow", location: "office gym",
      est_duration_min: 38, status: "done", blocks: office.blocks, logged: [],
      summary_notes: "recovery_flow: complete 37 min" },
    { session_type: "strength_b", status: "partial", adjusted: true,
      blocks: circuit("Office Strength B", { adjustment: {
        rules_fired: ["pain_lighter"], summary: ["Pain shoulder 2/5 → incline DB press 20 lb (last 25)."] } }),
      logged: [{ exercise: "DB goblet squat", log_type: "strength_set", sets: 1, reps: [12],
                 top_weight_lbs: 25, duration_sec: null, skipped: 0 }] },
    { session_type: "recovery_flow", display_name: "Recovery Flow", location: "home",
      est_duration_min: 30, status: "missed",
      blocks: { ...office.blocks, location: "home", pre: [] } },
    { session_type: "walk", display_name: "Walk", location: "outside", est_duration_min: 30, status: "missed",
      blocks: { type: "steady", display_name: "Walk", duration_min: 30, intensity: "easy",
                equipment: ["walking shoes"] } },
    { session_type: "strength_c", display_name: "Office Strength C", est_duration_min: 40, status: "today",
      blocks: circuit("Office Strength C") },
    { session_type: "cardio_z2", display_name: "Zone 2 Cardio", est_duration_min: 20, status: "upcoming",
      blocks: { type: "steady", display_name: "Zone 2 Cardio", duration_min: 20, intensity: "Zone 2",
                equipment: ["treadmill", "elliptical"] } },
  ];
  return {
    today: TODAY, timezone: "America/Chicago", range_from: from, range_to: addDays(from, 6),
    days: rows.map((r, i) => {
      const d = addDays(from, i);
      const status = from === "2026-09-16" ? r.status : d < TODAY ? "missed" : "upcoming";
      return planDay(d, { ...r, plan_id: 300 + i, week_num: w, status,
                          logged: from === "2026-09-16" ? r.logged ?? [] : [] });
    }),
  };
}

async function mockApi(page: Page, opts: { planFail?: () => boolean } = {}) {
  const planCalls: string[] = [];
  await page.route("**/api/health/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/plan")) {
      planCalls.push(url.search);
      if (opts.planFail?.()) return route.abort("internetdisconnected");
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      if (to === addDays(from, 3)) {           // Tomorrow's 4-day window
        const w = week("2026-09-16");
        const next = planDay(addDays(TODAY, 1), {
          plan_id: 399, session_type: "strength_a", display_name: "Office Strength A",
          est_duration_min: 40, status: "upcoming", blocks: circuit("Office Strength A") });
        return route.fulfill({ json: { ...w, range_from: from, range_to: to,
                                       days: [w.days[4], w.days[5], next] } });
      }
      return route.fulfill({ json: week(from) });
    }
    if (path.endsWith("/today")) return route.fulfill({ json: STRENGTH_TODAY });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: TODAY, window_start: "2026-09-16", window_end: "2026-09-26",
        today_summary: { plan_id: 110, session_type: "strength_c", is_skipped: false, is_logged: false, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: 110, exercises: [], has_session_summary: false } });
    return route.fulfill({ json: { by_exercise: {}, days: [] } });
  });
  return planCalls;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0)
      .filter(({ r }) => r.width < 56 || r.height < 56)
      .map(({ el, r }) => `${el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small).toEqual([]);
}

async function expectNoKeyboardTriggers(page: Page) {
  const n = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select, [contenteditable]"))
      .filter((el) => el.getAttribute("inputmode") !== "none").length);
  expect(n).toBe(0);
}

/** The detail actually renders: name and body are visible and stacked below
 * the date line (a stray page-level class once blanked it). */
async function expectDetailReadable(page: Page) {
  const d = page.getByTestId("plan-detail");
  const name = d.locator(".plan-detail-name");
  await expect(name).toBeVisible();
  await expect(d.locator(".plan-detail-body")).toBeVisible();
  const meta = (await d.locator(".meta").first().boundingBox())!;
  const nb = (await name.boundingBox())!;
  expect(meta.height).toBeLessThan(60);
  expect(nb.y).toBeGreaterThan(meta.y);
  expect(nb.y - (meta.y + meta.height)).toBeLessThan(40);
}

async function openFromSetup(page: Page, name: "Tomorrow" | "Week") {
  await page.clock.install({ time: new Date(`${TODAY}T12:00:00-05:00`) });
  await page.goto("/today");
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
  const btn = page.getByRole("button", { name, exact: true });
  const box = (await btn.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  await btn.tap();
}

test("Tomorrow: read-only plan with sets × reps, RPE cap, check-in footer", async ({ page }) => {
  const calls = await mockApi(page);
  await openFromSetup(page, "Tomorrow");
  const detail = page.getByTestId("plan-detail");
  await expect(detail).toBeVisible();
  await expectDetailReadable(page);
  expect(calls[0]).toBe("?from=2026-09-20&to=2026-09-23");
  await expect(detail).toContainText("Tue 9/22");
  await expect(detail).toContainText("Office Strength A");
  await expect(detail).toContainText("office gym · 40 min · Phase 1 · Week 1");
  await expect(detail).toContainText("DB goblet squat — 2 × 8-12 · RPE ≤6");
  await expect(detail).toContainText("Incline DB press — 2 × 8-12 · RPE ≤6 · 20 lb (last 25)");
  await expect(detail).toContainText("Adjusts after your morning check-in.");
  await expect(page.getByRole("button", { name: /start/i })).toHaveCount(0);
  await expectTouchTargets(page);
  await expectNoKeyboardTriggers(page);
  await shot(page, "week-0-tomorrow");

  // Fetched when opened (StrictMode runs the effect twice in dev), never polled.
  const opened = calls.length;
  expect(new Set(calls)).toEqual(new Set(["?from=2026-09-20&to=2026-09-23"]));
  await page.clock.runFor(10 * 60_000);
  expect(calls).toHaveLength(opened);

  await page.getByTestId("bottom-bar").getByRole("button", { name: "Today", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Start Workout" })).toBeVisible();
});

test("Week: statuses, adjusted badge, today, past detail, navigation", async ({ page }) => {
  const calls = await mockApi(page);
  await openFromSetup(page, "Week");
  await expect(page.getByTestId("week-title")).toContainText("Phase 1 · Week 1");
  await expect(page.getByTestId("week-title")).toContainText("Wed 9/16 – Tue 9/22");
  expect(calls[0]).toBe("?from=2026-09-16&to=2026-09-22");

  const row = (d: string) => page.getByTestId(`week-row-${d}`);
  await expect(row("2026-09-16")).toContainText("Office Strength A");
  await expect(row("2026-09-16")).toContainText("40 min");
  await expect(row("2026-09-16").locator(".week-status")).toHaveText("✓");
  await expect(row("2026-09-17")).toContainText("Recovery Flow");
  await expect(row("2026-09-17")).toContainText("41 min");   // YOGA-4 office flow: 40:32
  await expect(row("2026-09-18").locator(".week-status")).toHaveText("◐");
  await expect(row("2026-09-18")).toContainText("Adjusted");
  await expect(row("2026-09-19").locator(".week-status")).toHaveText("✕");
  await expect(row("2026-09-21")).toHaveAttribute("aria-current", "date");
  await expect(row("2026-09-21")).toHaveClass(/week-row--today/);
  await expect(row("2026-09-22").locator(".week-status")).toHaveText("•");
  await expect(page.getByRole("button", { name: /start/i })).toHaveCount(0);

  await expectTouchTargets(page);
  await expectNoKeyboardTriggers(page);

  // Layout: landscape = list | today's detail; portrait = the list only.
  const list = (await page.getByTestId("week-list").boundingBox())!;
  if (test.info().project.name === "ipad-landscape") {
    await expect(page.getByTestId("plan-detail")).toContainText("Mon 9/21");
    await expectDetailReadable(page);
    const det = (await page.locator(".week-detail").boundingBox())!;
    expect(det.x).toBeGreaterThanOrEqual(list.x + list.width - 1);
  } else {
    await expect(page.locator(".week-detail")).toBeHidden();
  }
  await shot(page, "week-1-week");

  const back = () => page.getByTestId("bottom-bar").getByRole("button", { name: "Week", exact: true }).tap();

  // A past day opens as its own view and shows what was logged.
  await row("2026-09-16").tap();
  await expect(page.getByTestId("peek-day")).toBeVisible();
  await expectDetailReadable(page);
  const logged = page.getByTestId("plan-detail-logged");
  await expect(logged).toContainText("Leg press — 2 sets · 12, 11 reps · top 180 lb");
  await expect(page.getByTestId("plan-detail")).not.toContainText("Adjusts after your morning check-in.");
  await shot(page, "week-2-past-day");
  await back();

  // The adjusted day explains itself; the flow day lists its poses.
  await row("2026-09-18").tap();
  await expect(page.getByTestId("plan-detail-adjusted")).toContainText("Pain shoulder 2/5");
  await expect(page.getByTestId("plan-detail")).toContainText("Incline DB press — 2 × 8-12 · RPE ≤6 · 20 lb (last 25)");
  await back();
  await row("2026-09-17").tap();
  await expect(page.getByTestId("plan-detail")).toContainText("40:32 total · 2 rounds");
  await expect(page.getByTestId("plan-detail")).toContainText("recovery_flow: complete 37 min");
  await back();

  // Navigation → week 7 shows Deload.
  await page.getByRole("button", { name: "Next week" }).tap();
  await expect(page.getByTestId("week-title")).toContainText("Week 2");
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Next week" }).tap();
  await expect(page.getByTestId("week-title")).toContainText("Phase 1 · Week 7 · Deload");
  await expect(page.getByTestId("week-title")).toContainText("Wed 10/28 – Tue 11/3");
  await shot(page, "week-3-deload");
  await page.getByRole("button", { name: "Previous week" }).tap();
  await expect(page.getByTestId("week-title")).toContainText("Wed 10/21");
  expect(calls.at(-1)).toBe("?from=2026-10-21&to=2026-10-27");
});

test("Week offline: last data, marked 'as of'", async ({ page }) => {
  let fail = false;
  await mockApi(page, { planFail: () => fail });
  await openFromSetup(page, "Week");
  await expect(page.getByTestId("week-row-2026-09-16")).toContainText("✓");
  await page.getByTestId("bottom-bar").getByRole("button", { name: "Today", exact: true }).tap();
  fail = true;
  await page.getByRole("button", { name: "Week", exact: true }).tap();
  await expect(page.getByTestId("peek-stale")).toHaveText(/^Offline — as of \d\d:\d\d$/);
  await expect(page.getByTestId("week-row-2026-09-16")).toContainText("✓");
  await shot(page, "week-4-offline");
});

test("an active workout is never interrupted by the views", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await expect(page.getByRole("button", { name: "Tomorrow", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveCount(0);
});
