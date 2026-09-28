import { expect, test, type Page } from "@playwright/test";
import yoga6 from "../tests/fixtures/yoga-strength-richfield.json" with { type: "json" };
import core from "../tests/fixtures/core-richfield.json" with { type: "json" };

// EXTRA-FIGURES (2026-09-28) — proof the figure slot is in place on BOTH screens:
// the Flow screen (YOGA-6) and the circuit screen (Core). Screenshots go to
// e2e/screenshots/ for review.

const TODAY = "2026-05-03";

function status(plan: { plan_id: number; session_type: string }) {
  return {
    today: TODAY, window_start: "2026-04-28", window_end: "2026-05-08",
    today_summary: { plan_id: plan.plan_id, session_type: plan.session_type,
                     is_skipped: false, is_logged: false, exists: true },
    banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: TODAY },
    day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [],
    weight_trend: [],
  };
}

async function mockApi(page: Page, plan: Record<string, unknown>) {
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const p = { ...plan, plan_date: TODAY } as { plan_id: number; session_type: string };
    if (path.endsWith("/today")) return route.fulfill({ json: p });
    if (path.endsWith("/status")) return route.fulfill({ json: status(p) });
    if (path.endsWith("/log")) return route.fulfill({ json: { plan_id: p.plan_id, inserted: 1, rows: [] } });
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: p.plan_id, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: { days: [] } });
    return route.fulfill({ json: { by_exercise: {} } });
  });
}

test("a YOGA-6 flow step shows its figure", async ({ page }) => {
  await mockApi(page, yoga6);
  await page.clock.install();
  await page.goto("/today");
  await page.getByRole("button", { name: "Start" }).tap();
  // Far enough in to be holding a pose that has art.
  // Far enough in to be HOLDING a pose rather than on a round or side card.
  // 45 s in: past the centering and the round card, holding a pose with art.
  await page.clock.runFor(45_000);
  // NB the figure IS the .flow-figure element, not a child of one.
  const fig = page.locator('.flow-figure[data-testid="pose-figure"]');
  await expect(fig.first()).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-flow-figure.png` });
});

test("a Core circuit step shows its figure", async ({ page }) => {
  await mockApi(page, core);
  await page.clock.install();
  await page.goto("/today");
  await page.getByRole("button", { name: "Start" }).tap();
  await page.clock.runFor(5_000);
  const fig = page.locator('.glance-thumb[data-testid="pose-figure"]').first();
  await expect(fig).toBeVisible();
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-circuit-figure.png` });
});
