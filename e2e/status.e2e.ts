import { expect, test, type Page } from "@playwright/test";
import overview from "../tests/fixtures/overview.json" with { type: "json" };

// STATUS-1 — the rebuilt Status page on iPad WebKit (landscape + portrait).
// Fixture: a done strength day (9/16), a partial flow (9/17), an adjusted day
// (9/18), a missed flow (9/19), pain + soreness check-ins, one pattern, flags.

const SECTIONS = ["st-program", "st-week", "st-today", "st-strength", "st-checkins",
                  "st-patterns", "st-flags", "st-weight"];

async function mockApi(page: Page, opts: { offline?: () => boolean } = {}) {
  await page.route("**/api/health/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith("/overview")) {
      if (opts.offline?.()) return route.abort("internetdisconnected");
      return route.fulfill({ json: overview });
    }
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: overview.date, window_start: "2026-09-16", window_end: "2026-09-26",
        today_summary: { plan_id: 108, session_type: "strength_c", is_skipped: false, is_logged: true, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: overview.date },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today")) return route.fulfill({ json: { ...overview.today.day, is_skipped: false } });
    if (path.endsWith("/plan")) {
      const from = url.searchParams.get("from")!;
      const to = url.searchParams.get("to")!;
      const days = [];
      for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10);
        days.push({ ...overview.week_days[4], plan_id: 900 + d.getUTCDate(), plan_date: iso, phase: 3,
                    week_num: 14, display_name: "Long Z2 Bike", status: "done" });
      }
      return route.fulfill({ json: { today: overview.date, timezone: "America/Chicago",
                                     range_from: from, range_to: to, days } });
    }
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: 108, exercises: [], has_session_summary: false } });
    return route.fulfill({ json: { by_exercise: {}, days: [] } });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

async function openStatus(page: Page) {
  await page.goto("/status");
  await expect(page.getByTestId("st-program")).toBeVisible();
}

/** Scroll the page to `sel` and check it is fully on screen above the bar. */
async function expectFullyVisible(page: Page, sel: string) {
  const el = page.locator(sel).last();
  await el.scrollIntoViewIfNeeded();
  // scrollIntoViewIfNeeded may leave it under the fixed bar — nudge past it.
  await page.getByTestId("status-page").evaluate((root, s) => {
    const all = root.querySelectorAll(s);
    const target = all[all.length - 1] as HTMLElement;
    const bar = document.querySelector('[data-testid="bottom-bar"]')!.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const top = root.getBoundingClientRect().top;
    const room = bar.top - top;
    if (r.height >= room) {
      root.scrollTop += r.bottom - bar.top + 8;          // tall: show its end
    } else if (r.bottom > bar.top) {
      root.scrollTop += r.bottom - bar.top + 8;
    } else if (r.top < top) {
      root.scrollTop -= top - r.top;
    }
  }, sel);
  const box = (await el.boundingBox())!;
  const bar = (await page.getByTestId("bottom-bar").boundingBox())!;
  expect(box.height).toBeGreaterThan(0);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + 0.5);
  // Short elements must be wholly on screen; a tall one (the strength table)
  // must at least show its end above the bar.
  const top = (await page.getByTestId("status-page").boundingBox())!.y;
  if (box.height < bar.y - top) expect(box.y).toBeGreaterThanOrEqual(top - 0.5);
  else expect(box.y + box.height).toBeGreaterThan(top);
  // Not clipped by its section.
  const clipped = await el.evaluate((node) => {
    let p = node.parentElement;
    const r = node.getBoundingClientRect();
    while (p && !p.classList.contains("status2")) {
      const cs = getComputedStyle(p);
      if (cs.overflowY === "hidden" || cs.overflowY === "clip") {
        const pr = p.getBoundingClientRect();
        if (r.bottom > pr.bottom + 0.5 || r.top < pr.top - 0.5) return true;
      }
      p = p.parentElement;
    }
    return false;
  });
  expect(clipped, `${sel} is clipped`).toBe(false);
}

test("every section renders fully, nothing clipped, no horizontal page scroll", async ({ page }) => {
  await mockApi(page);
  await openStatus(page);
  const landscape = test.info().project.name === "ipad-landscape";

  // Program header
  const program = page.getByTestId("st-program");
  await expect(program.getByRole("heading")).toHaveText("Foundation · Phase 1 · Week 1 of 7");
  await expect(program).toContainText("Started 9/16");
  await expect(program).toContainText("Deload in 6 weeks");
  await expect(program).toContainText("3 / 6 sessions done");
  await shot(page, "status-0-top");

  // No old-program rows anywhere
  await expect(page.getByText("Long Z2 Bike")).toHaveCount(0);
  await expect(page.getByText(/P3|W14|W15|Run-Walk/)).toHaveCount(0);

  // This week tiles
  await expect(page.getByTestId("st-tile-2026-09-16")).toContainText("✓");
  await expect(page.getByTestId("st-tile-2026-09-17")).toContainText("◐");
  await expect(page.getByTestId("st-tile-2026-09-18")).toContainText("Adjusted");
  await expect(page.getByTestId("st-tile-2026-09-19")).toContainText("✕");
  await expect(page.getByTestId("st-tile-2026-09-21")).toHaveAttribute("aria-current", "date");

  // Today
  await expect(page.getByTestId("st-progress")).toHaveText("Sets 1 / 12");
  await expect(page.getByTestId("st-checkin")).toContainText("Sleep 7.5 h · Energy 4/5 · Weight 282.6 lb · RHR 58 bpm");
  await expect(page.getByTestId("st-checkin")).toContainText("low back 3/5");

  // Layout: landscape = two columns (1–3 | 4–8); portrait = one column.
  const left = (await page.getByTestId("st-program").boundingBox())!;
  const right = (await page.getByTestId("st-strength").boundingBox())!;
  if (landscape) {
    expect(right.x).toBeGreaterThan(left.x + left.width - 1);
  } else {
    expect(Math.abs(right.x - left.x)).toBeLessThan(2);
    const today = (await page.getByTestId("st-today").boundingBox())!;
    expect(right.y).toBeGreaterThan(today.y + today.height - 1);
  }

  // Every section's last element can be seen whole.
  for (const id of SECTIONS) {
    await expectFullyVisible(page, `[data-testid="${id}"] .st-body > :last-child`);
  }
  await expectFullyVisible(page, '[data-testid="st-strength"] tbody tr');
  await expectFullyVisible(page, '[data-testid="st-flags"] li');
  await expectFullyVisible(page, '[data-testid="weight-summary"] li');
  await expectFullyVisible(page, '[data-testid="previous-program"]');

  // Page never scrolls sideways; wide tables scroll inside their own box.
  const m = await page.evaluate(() => {
    const root = document.querySelector(".status2") as HTMLElement;
    return { doc: document.documentElement.scrollWidth - window.innerWidth,
             page: root.scrollWidth - root.clientWidth };
  });
  expect(m.doc).toBeLessThanOrEqual(0);
  expect(m.page).toBeLessThanOrEqual(0);
  const table = page.getByTestId("st-strength-scroll");
  const tableOverflowX = await table.evaluate((el) => getComputedStyle(el).overflowX);
  expect(tableOverflowX).toBe("auto");
  // In landscape the six columns fit without inner scrolling; Machine setup is on screen.
  const fits = await table.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  const setupHead = (await page.getByTestId("st-strength").getByRole("columnheader", { name: "Machine setup" }).boundingBox())!;
  const tableBox = (await table.boundingBox())!;
  expect(setupHead.x + setupHead.width).toBeLessThanOrEqual(tableBox.x + tableBox.width + 1);
  // Content never slides under the top tabs.
  const tabsBottom = (await page.getByRole("link", { name: "Status" }).boundingBox())!;
  const scrollTop = (await page.getByTestId("status-page").boundingBox())!.y;
  expect(scrollTop).toBeGreaterThanOrEqual(tabsBottom.y + tabsBottom.height);

  // Labels on every number: strength headers, chart units.
  await expect(page.getByTestId("st-strength").getByRole("columnheader")).toHaveText(
    ["Exercise", "Last", "Previous", "Trend", "Best", "Machine setup"]);
  await expect(page.getByTestId("spark-energy")).toContainText("Energy (0–5)");
  await expect(page.getByTestId("spark-sleep")).toContainText("Sleep (hours)");
  await expect(page.getByTestId("weight-chart")).toContainText("lb");
  await expect(page.getByTestId("st-patterns")).toContainText("3 of 4 sessions");
  await expect(page.getByTestId("st-patterns")).toContainText("Last reflection 9/20");
  await expect(page.getByTestId("st-flags")).toContainText("Missed: Recovery Flow (9/19)");
  await expect(page.getByTestId("st-flags")).toContainText("Pain chip: shoulder 2 on Incline DB press (9/18)");
  // Soreness vs pain are visually distinct.
  const kinds = await page.locator(".st-cell--pain[data-level='3'], .st-cell--sore[data-level='3']")
    .evaluateAll((els) => els.map((e) => `${e.className}|${getComputedStyle(e).backgroundColor}`));
  expect(new Set(kinds.map((k) => k.split("|")[1])).size).toBe(2);

  // Read-only, touchable, no keyboard.
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button, a[href]"))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 56 || r.height < 56))
      .map(({ el, r }) => `${el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`));
  expect(small).toEqual([]);
  const keyboard = await page.evaluate(() =>
    document.querySelectorAll("input, textarea, select, [contenteditable]").length);
  expect(keyboard).toBe(0);
  await expect(page.getByRole("button", { name: /start/i })).toHaveCount(0);
  expect(await page.getByTestId("bottom-bar").getByRole("button").allTextContents())
    .toEqual(["Today", "Tomorrow", "Week"]);

  await page.getByTestId("st-strength").scrollIntoViewIfNeeded();
  await shot(page, "status-1-middle");
  await page.getByTestId("previous-program").scrollIntoViewIfNeeded();
  await shot(page, "status-2-bottom");
});

test("a tile opens the day detail; Previous program is a read-only list", async ({ page }) => {
  await mockApi(page);
  await openStatus(page);
  await page.getByTestId("st-tile-2026-09-16").tap();
  await expect(page.getByTestId("status-day")).toBeVisible();
  await expect(page.getByTestId("plan-detail-logged")).toContainText("Leg press — 2 sets · 12, 11 reps · top 180 lb");
  expect(await page.getByTestId("bottom-bar").getByRole("button").allTextContents()).toEqual(["Today", "Week"]);
  await shot(page, "status-3-day");

  // The Status tab brings the page back.
  await page.getByRole("link", { name: "Status" }).tap();
  await expect(page.getByTestId("st-program")).toBeVisible();

  await page.getByTestId("previous-program").tap();
  await expect(page.getByTestId("status-previous")).toBeVisible();
  await expect(page.getByTestId("status-previous")).toContainText("Long Z2 Bike");
  await expect(page.getByTestId("status-previous")).toContainText("P3 W14");
  await expect(page.getByTestId("status-previous").getByRole("button", { name: "Start" })).toHaveCount(0);
  await shot(page, "status-4-previous");
  await page.getByRole("button", { name: "Back to Status" }).tap();
  await expect(page.getByTestId("st-program")).toBeVisible();
});

test("offline: last data, marked 'as of'", async ({ page }) => {
  let offline = false;
  await mockApi(page, { offline: () => offline });
  await openStatus(page);
  offline = true;
  await page.reload();
  await expect(page.getByTestId("status-stale")).toHaveText(/^Offline — as of \d\d:\d\d$/);
  await expect(page.getByTestId("st-program")).toBeVisible();
});
