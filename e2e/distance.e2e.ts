import { expect, test, type Page } from "@playwright/test";
import overview from "../tests/fixtures/overview.json" with { type: "json" };

// ---------------------------------------------------------------------------
// GD-DISTANCE — the active-set screen, read from ~20 ft. WebKit at the real
// iPad Pro 11" viewport, both orientations.
//
// The panel is 264 ppi at DPR 2, so 132 CSS px = 1 physical inch. Digit height
// is measured from the rendered font's own glyph metrics, not assumed.
// ---------------------------------------------------------------------------

const TODAY = "2026-09-21";
const CSS_PX_PER_INCH = 264 / 2;

const PLAN = {
  plan_id: 101, plan_date: TODAY, phase: 1, week_num: 1, session_type: "strength_a",
  target_rpe: 6, est_duration_min: 40, is_skipped: false,
  blocks: {
    type: "circuit", display_name: "Office Strength A", location: "office gym", rounds: 2,
    warmup: "5 min elliptical, easy", cooldown: "5 min Stretch Trainer", rest_between_rounds_sec: 90,
    equipment: ["leg press"],
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60,
        notes: "2×10-12; log seat + pin setting" },
      { name: "DB bench press", format: "reps", target_reps: 12, target_load_lbs: null, rest_after_sec: 60 },
    ],
  },
};

// The LAST set, per /last_logged: 175 × 12 @ RPE 7.
const LAST_SET = {
  exercise: "Leg press", plan_date: "2026-09-18", weight_lbs: 175, reps_done: 12, rpe_actual: 7,
  duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null, notes: null,
};

// …while that session's sets AVERAGE 150 (140, 150, 160). If the LAST tile
// ever showed the average, it would read 150 — so this test can fail.
function set(weight: number, rpe: number, n: number) {
  return {
    log_id: n, log_type: "strength_set", exercise: "Leg press", set_num: n, reps_done: 12,
    weight_lbs: weight, duration_sec: null, distance_m: null, hr_avg: null, hr_peak: null,
    rpe_actual: rpe, notes: null, is_skipped: false, logged_at: "2026-09-18T12:00:00Z",
    logged_via: "ipad",
  };
}
const SESSIONS = {
  today: TODAY, window_start: "2026-09-15", window_end: TODAY,
  days: [{
    plan_date: "2026-09-18", plan_id: 90, session_type: "strength_a", display_name: "Office Strength A",
    phase: 1, week_num: 1, target_rpe: 6, target_hr_zone: null, is_skipped: false, is_today: false,
    planned_set_count: 3, logged_set_count: 3, avg_set_rpe: 6, hr_avg: null, hr_peak: null,
    total_work_sec: 0, session_summary: null,
    sets: [set(140, 5, 1), set(150, 6, 2), set(160, 7, 3)],
    outliers: { high_rpe_sets: [], incomplete: false, incomplete_logged: 0, incomplete_planned: 0, pain_notes: [] },
  }],
};

const STATUS = {
  today: TODAY, window_start: "2026-09-15", window_end: TODAY,
  today_summary: { plan_id: 101, session_type: "strength_a", exists: true, is_skipped: false, is_logged: false },
  banner: { phase: 1, week_num: 1, phase_name: "Office ramp", as_of_date: TODAY },
  day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
};

async function mockApi(page: Page, { lastLoggedDelayMs = 0 } = {}) {
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: PLAN });
    if (path.endsWith("/status")) return route.fulfill({ json: STATUS });
    if (path.endsWith("/today/logged")) {
      return route.fulfill({ json: { plan_id: 101, exercises: [], has_session_summary: false } });
    }
    if (path.endsWith("/last_logged")) {
      if (lastLoggedDelayMs) await new Promise((r) => setTimeout(r, lastLoggedDelayMs));
      return route.fulfill({ json: { by_exercise: { "Leg press": LAST_SET } } });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: SESSIONS });
    if (path.endsWith("/overview")) return route.fulfill({ json: overview });
    if (path.endsWith("/log")) return route.fulfill({ json: { plan_id: 101, inserted: 1, rows: [] } });
    return route.fulfill({ status: 404, json: {} });
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}-${name}.png` });
}

async function toFirstSet(page: Page) {
  await page.goto("/today");
  await page.getByRole("button", { name: "Start Workout" }).tap();
  await expect(page.getByTestId("glance-time")).toHaveAttribute("data-mode", "rest");  // warmup
}

async function skipToSet(page: Page) {
  await page.getByRole("button", { name: "Skip to next" }).tap();
  await expect(page.getByTestId("glance-strength")).toBeVisible();
}

/** Rendered digit height of a tile's numeral, in CSS px and inches.
 *
 * Uses the CSS `cap` unit on a probe INSIDE the real element: that is the
 * cap height of the font the page actually rendered. Not canvas — canvas
 * resolved a different optical size and measured digits 13 % too narrow. */
async function digitHeight(page: Page, testId: string) {
  return page.getByTestId(testId).locator(".stile-num").evaluate((el) => {
    const probe = document.createElement("span");
    Object.assign(probe.style, { display: "inline-block", width: "0", height: "1cap",
      verticalAlign: "baseline" });
    el.appendChild(probe);
    const px = probe.getBoundingClientRect().height;
    probe.remove();
    return { fontSize: parseFloat(getComputedStyle(el).fontSize), digitPx: px };
  }).then((r) => ({ ...r, inches: r.digitPx / CSS_PX_PER_INCH }));
}

async function boxes(page: Page) {
  const ids = ["tile-reps", "tile-rpe", "tile-last"];
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const id of ids) {
    const b = (await page.getByTestId(id).boundingBox())!;
    out[id] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
  const n = (await page.locator(".glance-name").boundingBox())!;
  out.name = { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width), h: Math.round(n.height) };
  return out;
}

test("the three tiles, with the right values", async ({ page }) => {
  await mockApi(page);
  await toFirstSet(page);
  await skipToSet(page);

  await expect(page.getByTestId("tile-reps").locator(".stile-num")).toHaveText("12");
  await expect(page.getByTestId("tile-rpe").locator(".stile-num")).toHaveText("6");
  await expect(page.getByTestId("tile-rpe-sub")).toHaveText("stop with ~4 reps left");
  await expect(page.getByTestId("tile-last").locator(".stile-num")).toHaveText("175lb");
  await expect(page.getByTestId("tile-last-sub")).toHaveText("×12 · RPE 7");

  // SET x OF y above the name, in the accent; the name beneath the tiles.
  await expect(page.locator(".glance-set")).toHaveText("Set 1 of 2");
  const set = (await page.locator(".glance-set").boundingBox())!;
  const name = (await page.locator(".glance-name").boundingBox())!;
  const tiles = (await page.getByTestId("strength-tiles").boundingBox())!;
  expect(tiles.y + tiles.height).toBeLessThanOrEqual(set.y);
  expect(set.y + set.height).toBeLessThanOrEqual(name.y);
  expect(await page.locator(".glance-set").evaluate((e) => getComputedStyle(e).color))
    .toBe("rgb(255, 209, 102)");

  // The old small lines are gone from this screen.
  await expect(page.locator(".glance-prev")).toHaveCount(0);
  await expect(page.getByText("2×10-12; log seat + pin setting")).toHaveCount(0);
  await expect(page.getByTestId("glance-target-block")).toHaveCount(0);

  // Tiles are lighter panels on the work green — no yellow anywhere in them.
  const bg = await page.getByTestId("tile-reps").evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toBe("rgba(255, 255, 255, 0.09)");
  for (const id of ["tile-reps", "tile-rpe", "tile-last"]) {
    const colours = await page.getByTestId(id).evaluate((root) =>
      [root, ...root.querySelectorAll("*")].map((e) => getComputedStyle(e).color));
    expect(colours, id).not.toContain("rgb(255, 209, 102)");
  }

  await shot(page, "distance-1-active-set");
});

test("LAST is the last set (175), not the session average (150)", async ({ page }) => {
  await mockApi(page);
  await toFirstSet(page);
  await skipToSet(page);
  const last = page.getByTestId("tile-last").locator(".stile-num");
  await expect(last).toHaveText("175lb");
  await expect(last).not.toContainText("150");
});

test("the timer is full size at rest and about half during the set", async ({ page }) => {
  await mockApi(page);
  await toFirstSet(page);
  const rest = await page.getByTestId("glance-time").evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  await shot(page, "distance-0-rest-timer");
  await skipToSet(page);
  const timer = page.getByTestId("glance-strength").getByTestId("glance-time");
  const setSize = await timer.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const ratio = setSize / rest;
  console.log(`[${test.info().project.name}] timer: rest ${rest}px, set ${setSize}px, ratio ${ratio.toFixed(2)}`);
  expect(ratio).toBeGreaterThan(0.4);
  expect(ratio).toBeLessThan(0.6);
});

test("nothing moves: not when /last_logged arrives late, not as the timer ticks", async ({ page }) => {
  await mockApi(page, { lastLoggedDelayMs: 2500 });
  await toFirstSet(page);
  await skipToSet(page);
  // Before the data: the LAST tile is already there, holding its space.
  await expect(page.getByTestId("tile-last").locator(".stile-num")).toHaveText("—");
  const before = await boxes(page);
  await expect(page.getByTestId("tile-last").locator(".stile-num")).toHaveText("175lb", { timeout: 8000 });
  const after = await boxes(page);
  expect(after).toEqual(before);
  // …and through a timer width change (0:0x → 0:1x).
  await page.waitForTimeout(11_000);
  expect(await boxes(page)).toEqual(before);
});

test("physical size at 20 ft: the numbers, measured", async ({ page }) => {
  await mockApi(page);
  await toFirstSet(page);
  await skipToSet(page);
  const proj = test.info().project.name;
  const r = {
    reps: await digitHeight(page, "tile-reps"),
    rpe: await digitHeight(page, "tile-rpe"),
    last: await digitHeight(page, "tile-last"),
  };
  for (const [k, v] of Object.entries(r)) {
    console.log(`[${proj}] ${k.toUpperCase()}: font-size ${v.fontSize.toFixed(1)}px → ` +
      `digits ${v.digitPx.toFixed(1)}px = ${v.inches.toFixed(2)} in`);
  }
  // Nothing overflows its tile.
  for (const id of ["tile-reps", "tile-rpe", "tile-last"]) {
    const over = await page.getByTestId(id).locator(".stile-num").evaluate(
      (e) => e.scrollWidth > (e.parentElement as HTMLElement).clientWidth + 1);
    expect(over, `${id} overflows`).toBe(false);
  }
  // …and no sub-line is cut off. (A first cut ellipsised "stop with ~4 reps
  // left" to "stop with ~4 reps…" — the text content was right, so only a
  // check of what is actually VISIBLE could catch it.)
  for (const id of ["tile-rpe-sub", "tile-last-sub"]) {
    const clipped = await page.getByTestId(id).evaluate(
      (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1);
    expect(clipped, `${id} is clipped`).toBe(false);
  }
  // REPS and RPE render at the same size.
  expect(Math.abs(r.reps.fontSize - r.rpe.fontSize)).toBeLessThan(1);
  if (proj === "ipad-landscape") {
    // A floor, so a regression shows: the most three-across-the-right-pane
    // allows is ~0.77 in (see the PR for why 1.5 in is not reachable here).
    expect(r.reps.inches).toBeGreaterThan(0.72);
  }
});
