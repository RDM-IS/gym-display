import { expect, test, type Page } from "@playwright/test";

// GD-DEFER on an iPad-sized WebKit page: Monday Strength C, four machine /
// cable stations. "Busy — later" swaps an exercise with the next one in the
// round, from the rest ("Next: …") or on the exercise itself.

const TODAY = "2026-09-21";
const ex = (name: string) =>
  ({ name, format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60, notes: "2×10-12" });

const PLAN = {
  plan_id: 108, plan_date: TODAY, phase: 1, week_num: 1, session_type: "strength_c",
  target_rpe: 6, est_duration_min: 40, is_skipped: false,
  blocks: {
    type: "circuit", display_name: "Office Strength C", location: "office gym", rounds: 2,
    warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer", rest_between_rounds_sec: 90,
    equipment: ["DBs", "pec fly", "functional trainer", "adjustable bench", "calf press", "ab machine"],
    exercises: [ex("DB Romanian deadlift"), ex("Pec fly"), ex("Single-arm cable row"),
                ex("Seated DB shoulder press"), ex("Calf press"), ex("Ab machine crunch")],
  },
};

async function mockApi(page: Page) {
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: PLAN });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: TODAY, window_start: "2026-09-14", window_end: "2026-09-24",
        today_summary: { plan_id: 108, session_type: "strength_c", is_skipped: false, is_logged: false, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: 108, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/log")) return route.fulfill({ json: { plan_id: 108, inserted: 1, rows: [] } });
    return route.fulfill({ json: { by_exercise: {} } });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

async function expectTouchTargets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => { const r = el.getBoundingClientRect();
        return { label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", w: r.width, h: r.height }; })
      .filter((b) => b.w < 56 || b.h < 56));
  expect(small).toEqual([]);
}

const glance = (page: Page) => page.locator(".glance-name");

test("Monday C: defer a busy pec fly from the rest, then a busy cable row", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();          // past warmup
  await expect(glance(page)).toHaveText("DB Romanian deadlift");
  await page.getByRole("button", { name: "Set done" }).tap();              // RDL's logging rest

  // The rest says pec fly is next; its machine is taken.
  await expect(page.locator(".restlog-next")).toHaveText("Next: Pec fly");
  await expect(page.getByTestId("defer-next")).toBeVisible();
  await expectTouchTargets(page);
  await shot(page, "defer-1-rest-before");
  await page.getByTestId("defer-next").tap();
  await expect(page.locator(".restlog-next")).toHaveText("Next: Single-arm cable row");
  await shot(page, "defer-2-rest-after");

  // On to the cable row — and that station is busy too: pec fly comes up now.
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await expect(glance(page)).toHaveText("Single-arm cable row");
  await expect(page.getByTestId("defer-current")).toBeVisible();
  await page.getByTestId("defer-current").tap();
  await expect(glance(page)).toHaveText("Pec fly");
  await expectTouchTargets(page);
  const w = page.viewportSize()!;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w.width);
  await shot(page, "defer-3-exercise");

  // Pec fly done → its own logging rest → the cable row is next.
  await page.getByRole("button", { name: "Set done" }).tap();
  await expect(page.locator(".restlog-next")).toHaveText("Next: Single-arm cable row");
});

test("the journey map tags a deferred exercise 'later'", async ({ page }) => {
  await mockApi(page);
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await page.getByRole("button", { name: "Skip to next" }).tap();          // RDL → its rest
  await page.getByRole("button", { name: "Skip to next" }).tap();             // → pec fly
  await expect(glance(page)).toHaveText("Pec fly");
  await page.getByTestId("defer-current").tap();
  await expect(glance(page)).toHaveText("Single-arm cable row");
  // Portrait collapses the map to a strip; open it first.
  const toggle = page.locator(".jmap-toggle");
  if (await toggle.count() && !(await page.locator(".jmap-list").isVisible())) await toggle.first().tap();
  await expect(page.getByTestId("jmap-later")).toHaveCount(1);
  await expect(page.locator(".jmap-item", { has: page.getByTestId("jmap-later") })).toContainText("Pec fly");
  await shot(page, "defer-4-map");
});
