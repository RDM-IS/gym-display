import { expect, test, type Page } from "@playwright/test";
import overview from "../tests/fixtures/overview-status3.json" with { type: "json" };

// STATUS-3 phase 1 — the one-screen Status page, in the REAL shell on iPad
// WebKit, landscape and portrait. Fixture values are synthetic.
//
// The spec's first requirement is "daily use needs zero scrolling", so that is
// measured here, with every fold closed, in both orientations.

const REC = { available: true, label: "Row ladder", reason: "no row in 2 days", primary: "row" };

/** The shell reads today's plan, the status strip and the week as well as
 * /overview, so they are mocked the way e2e/status.e2e.ts mocks them. */
async function mockApi(page: Page, data: unknown = overview) {
  const today = overview.today.day;
  await page.route("**/api/health/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/overview")) return route.fulfill({ json: data });
    if (path.endsWith("/recommend")) return route.fulfill({ json: REC });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: overview.date, window_start: overview.grid.start, window_end: overview.grid.end,
        today_summary: { plan_id: today.plan_id, session_type: today.session_type, is_skipped: false, is_logged: true, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: overview.date },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: today.plan_id, exercises: [], has_session_summary: false } });
    if (path.endsWith("/today")) return route.fulfill({ json: { ...today, is_skipped: false } });
    if (path.endsWith("/plan")) {
      const from = url.searchParams.get("from")!, to = url.searchParams.get("to")!;
      return route.fulfill({ json: { today: overview.date, timezone: overview.timezone, range_from: from,
        range_to: to, days: overview.grid.days.filter((d) => d.plan_date >= from && d.plan_date <= to) } });
    }
    return route.fulfill({ json: { by_exercise: {}, days: [] } });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-status3-${name}.png` });
}

/** 2026-11-14 at hh:mm Chicago (CST, UTC-6). */
const cst = (hm: string) => new Date(`2026-11-14T${hm}:00-06:00`);

async function open(page: Page, at = "05:10") {
  await page.clock.setFixedTime(cst(at));
  await mockApi(page);
  await page.goto("/status");
  await expect(page.getByTestId("status-grid")).toBeVisible();
}

test("daily use needs zero scrolling: banner, grid, tiles and folds fit above the bar", async ({ page }) => {
  await open(page);
  const m = await page.getByTestId("status-page").evaluate((el) => ({
    sh: el.scrollHeight, ch: el.clientHeight,
    doc: document.documentElement.scrollWidth - window.innerWidth,
  }));
  expect(m.sh, "the page scrolls with every fold closed").toBeLessThanOrEqual(m.ch + 1);
  expect(m.doc).toBeLessThanOrEqual(0);
  const bar = (await page.getByTestId("bottom-bar").boundingBox())!;
  for (const id of ["checkin-banner", "status-grid", "trend-tiles", "st3-prs", "st3-goals", "st3-recent", "st3-more"]) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b.y + b.height, `${id} ends under the bottom bar`).toBeLessThanOrEqual(bar.y + 0.5);
  }
  // Nothing slides under the top tabs.
  const tabs = (await page.getByRole("link", { name: "Status" }).boundingBox())!;
  const banner = (await page.getByTestId("checkin-banner").boundingBox())!;
  expect(banner.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  // Every fold is closed by default.
  for (const id of ["st3-prs", "st3-goals", "st3-recent", "st3-more"]) {
    await expect(page.getByTestId(id)).not.toHaveAttribute("open", "");
  }
  await shot(page, "0-screen");
});

test("the grid: 7 columns, today highlighted, Mon–Sun divider, colours, kcal", async ({ page }) => {
  await open(page);
  const heads = page.locator('[data-testid^="sg-head-"]');
  await expect(heads).toHaveCount(7);
  await expect(page.getByTestId("sg-head-2026-11-14")).toHaveAttribute("aria-current", "date");
  await expect(page.getByTestId("sg-head-2026-11-14")).toContainText("Today");
  // The divider sits between Sunday 11/15 and Monday 11/16, and only there.
  await expect(page.locator(".sg-head.sg-col--week")).toHaveCount(1);
  await expect(page.getByTestId("sg-head-2026-11-16")).toHaveClass(/sg-col--week/);
  const sun = (await page.getByTestId("sg-head-2026-11-15").boundingBox())!;
  const mon = (await page.getByTestId("sg-head-2026-11-16").boundingBox())!;
  const tue = (await page.getByTestId("sg-head-2026-11-17").boundingBox())!;
  expect(mon.x - (sun.x + sun.width)).toBeGreaterThan(tue.x - (mon.x + mon.width) + 3);

  await expect(page.getByTestId("sg-morning-2026-11-13")).toContainText("321 kcal");
  await expect(page.getByTestId("sg-morning-2026-11-13")).toHaveAttribute("data-tone", "green");
  await expect(page.getByTestId("sg-evening-2026-11-13")).toHaveAttribute("data-tone", "muted");
  await expect(page.getByTestId("sg-morning-2026-11-16")).toHaveAttribute("data-tone", "yellow");
  await expect(page.getByTestId("sg-morning-2026-11-15")).toContainText("Rest");
  await expect(page.getByTestId("sg-rec-2026-11-14")).toContainText("Row ladder");
  await expect(page.getByTestId("sg-rec-2026-11-16")).toContainText("Full body B");
  // Phase 1 never paints urgency colours.
  await expect(page.locator('[data-tone="red"], [data-tone="orange"]')).toHaveCount(0);

  // Every grid button is a real touch target.
  const small = await page.getByTestId("status-grid").evaluate((g) =>
    Array.from(g.querySelectorAll<HTMLElement>("button"))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width < 56 || r.height < 56).length);
  expect(small).toBe(0);
});

test("the check-in alert is amber before 04:30 and red from 04:30 Chicago time", async ({ page }) => {
  await open(page, "04:20");
  await expect(page.getByTestId("checkin-banner")).toHaveAttribute("data-state", "amber");
  await shot(page, "1-amber");
  await page.clock.setFixedTime(cst("04:31"));
  await page.reload();
  await expect(page.getByTestId("checkin-banner")).toHaveAttribute("data-state", "red");
  await shot(page, "2-red");
});

test("no banner once checked in", async ({ page }) => {
  const checked = { ...overview, today: { ...overview.today, checkin: overview.checkins_14d[0] } };
  await page.clock.setFixedTime(cst("05:10"));
  await mockApi(page, checked);
  await page.goto("/status");
  await expect(page.getByTestId("status-grid")).toBeVisible();
  await expect(page.getByTestId("checkin-banner")).toHaveCount(0);
});

test("tapping a cell opens the day; a fold opens across the full width", async ({ page }) => {
  await open(page);
  await page.getByTestId("sg-morning-2026-11-16").tap();
  await expect(page.getByTestId("status-day")).toBeVisible();
  await expect(page.getByTestId("status-day")).toContainText("Mon 11/16");
  await page.getByRole("link", { name: "Status" }).tap();
  await expect(page.getByTestId("status-grid")).toBeVisible();

  await page.getByTestId("st3-goals-summary").tap();
  await expect(page.getByTestId("st3-goals")).toHaveAttribute("open", "");
  await expect(page.getByTestId("st3-goals")).toContainText("3.5 lb down since the program started");
  const fold = (await page.getByTestId("st3-goals").boundingBox())!;
  const grid = (await page.getByTestId("status-grid").boundingBox())!;
  expect(Math.abs(fold.width - grid.width)).toBeLessThan(2);
  await shot(page, "3-goals-open");

  await page.getByTestId("st3-recent-summary").tap();
  await expect(page.getByTestId("st3-recent")).toContainText("Full body A");
  await expect(page.getByTestId("st3-recent")).toContainText("321 kcal");
});

test("today's Recommended cell opens Sessions", async ({ page }) => {
  await open(page);
  await page.getByTestId("sg-rec-2026-11-14").tap();
  await expect(page.getByTestId("status-grid")).toHaveCount(0);
});
