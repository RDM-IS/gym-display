import { expect, test, type Page } from "@playwright/test";

/**
 * SHELL LAYOUT — for EVERY top-level route, inside the real app shell:
 *   (a) nothing you can tap is hidden under the fixed top-right nav, and
 *   (b) the page scrolls far enough to reach its last element.
 *
 * WHY THIS EXISTS. Ryan opened /prep on the iPad and could not scroll, and the
 * Prep sub-tabs sat under the nav with "Steps" hidden behind SESSIONS. Both were
 * plainly visible on the device and invisible to me, because the screenshots I had
 * been taking rendered the Prep SCREEN on its own rather than the app — no nav, no
 * shell, no `.screen` height rule. A component in isolation cannot show you a
 * collision with a component that is not there.
 *
 * So this is deliberately generic and runs over every route, not over Prep: the
 * same two mistakes are available on every screen that gets added, and the next
 * one should fail here rather than on a counter-top.
 */

const ROUTES = ["/today", "/status", "/library", "/prep"] as const;

const TODAY = "2026-10-04";

/** Long enough to overflow an iPad in both orientations — the point is to force
 *  the scroll, so a short fixture would quietly pass a broken screen. */
const N_LONG = 40;

const EXERCISES = Array.from({ length: 8 }, (_, i) => ({
  name: `Exercise ${i + 1}`, format: "reps", target_reps: 20,
  notes: "3×12-20", rest_after_sec: 60, equipment_class: "machine",
}));

const PLAN = {
  plan_id: 1, plan_date: TODAY, phase: 1, week_num: 5, session_type: "strength_a",
  target_rpe: 7.5, est_duration_min: 42, is_skipped: false,
  blocks: {
    type: "circuit", display_name: "Strength A", location: "office gym", rounds: 3,
    warmup: "5 min easy", cooldown: "5 min stretch", equipment: ["DBs"],
    setup_notes: ["Progression — reps first."], exercises: EXERCISES,
  },
};

function shoppingItem(i: number) {
  return {
    ingredient_id: `i${i}`, name: `Ingredient number ${i + 1}`, category: "pantry",
    unit: "g", as_used_base: 100, purchased_base: 100, yield_factor: 1,
    on_hand_base: null, par_level_pkgs: null, required_base: 100, short_base: 100,
    packages: 1, package_size: 500, package_label: "500 g bag", price: null,
    store: "Store One", store_chain: "One", store_id: "s1", rank: 1,
    rank_basis: "notion", aisle: "Aisle 1", packages_now: 1, packages_later: null,
    later_day: null, flags: ["count_unknown"],
  };
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;

    // ── prep ────────────────────────────────────────────────────────────────
    if (path.endsWith("/api/prep/shopping")) {
      return route.fulfill({ json: {
        stay: { id: 1, start_date: TODAY, end_date: "2026-10-08", days: 5,
                shop_date: TODAY, source: "cycle", confirmed: false },
        stores: [{ store: "Store One", chain: "One", store_id: "s1", rank: 1,
                   item_count: N_LONG,
                   aisles: [{ aisle: "Aisle 1",
                              items: Array.from({ length: N_LONG }, (_, i) => shoppingItem(i)) }] }],
        item_count: N_LONG, flags: { count_unknown: N_LONG }, day_count: 4,
        menu_days: [{ day: TODAY, meals: 0 }, { day: "2026-10-05", meals: 4 }],
        sync: { databases: [], blocked: [] }, incomplete: false } });
    }
    if (path.endsWith("/api/prep/pantry")) {
      return route.fulfill({ json: {
        items: Array.from({ length: N_LONG }, (_, i) => ({
          ingredient_id: `p${i}`, name: `Pantry item ${i + 1}`, category: "pantry",
          unit: "g", on_hand_base: null, on_hand_pkgs: null, counted_at: null,
          count_source: null, package_size: 500, package_label: "500 g bag",
          store: "Store One", par_level_pkgs: null, shelf_life_days: null,
          countable_in_packages: true })),
        count: N_LONG, uncounted: N_LONG } });
    }
    if (path.endsWith("/api/prep/macros")) {
      return route.fulfill({ json: {
        target: { kcal: 2100, protein_g: 185, carb_g: 185, fat_g: 70, fiber_g: 38,
                  sugar_g: 25, plant_meals_min: 1, set_by: "ryan",
                  provisional: true, effective_from: "2026-09-29" },
        days: [
          { day: TODAY, meals: 0, totals: null, chips: [], no_data: [],
            placeholder: false, missing: [], no_menu: true },
          { day: "2026-10-05", meals: 4,
            totals: { kcal: 2114, protein_g: 221, carb_g: 178, fat_g: 64, fiber_g: 60 },
            chips: [{ macro: "kcal", value: 2114, target: 2100, direction: "over" },
                    { macro: "fiber_g", value: 12, target: 38, direction: "under" }],
            no_data: ["sugar_g"], placeholder: false, missing: [], no_menu: false },
        ],
        days_without_menu: 1 } });
    }
    if (path.endsWith("/api/prep/board")) {
      return route.fulfill({ json: {
        stay: { id: 1, start_date: TODAY, end_date: "2026-10-08" },
        stepless: [], kitchen: { ovenSlots: 2, burners: 2, airFryerSlots: 1,
                                 preheatMin: 10, tempChangeMin: 5, fillerMin: 6,
                                 fillerName: "Clean as you go" },
        recipes: Array.from({ length: 6 }, (_, i) => ({
          notionId: `r${i}`, name: `Recipe ${i + 1}`, servings: 2, grams: null,
          steps: [
            { stepNo: 1, name: `Prep ${i + 1}`, resource: "hands", mode: "active",
              baseMin: 4, perServingMin: 0, tempF: null, batchKey: null,
              chainKey: null, keepSeparate: false, keepSeparateNote: null,
              shortcutKey: null, notes: null },
            { stepNo: 2, name: `Cook ${i + 1}`, resource: "stove", mode: "passive",
              baseMin: 12, perServingMin: 0, tempF: null, batchKey: null,
              chainKey: null, keepSeparate: false, keepSeparateNote: null,
              shortcutKey: null, notes: null }] })) } });
    }
    if (path.endsWith("/api/prep/steps")) {
      return route.fulfill({ json: {
        recipes: Array.from({ length: N_LONG }, (_, i) => ({
          recipe_id: `r${i}`, name: `Recipe ${i + 1}`, slug: `r${i}`, servings: 2,
          plan_eligible: true, steps: [] })),
        with_steps: 0, without_steps: N_LONG,
        resources: ["hands", "oven", "stove", "air_fryer", "counter", "fridge"],
        modes: ["active", "passive", "unattended"] } });
    }
    if (path.includes("/api/prep/")) return route.fulfill({ json: {} });

    // ── health ──────────────────────────────────────────────────────────────
    if (path.endsWith("/today")) return route.fulfill({ json: PLAN });
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { logged: [] } });
    if (path.endsWith("/last_logged")) return route.fulfill({ json: { exercises: {} } });
    if (path.endsWith("/library")) {
      return route.fulfill({ json: { location: "office gym", location_key: "office",
        sessions: Array.from({ length: N_LONG }, (_, i) => ({
          key: `s${i}`, display_name: `Session ${i + 1}`, session_type: "yoga",
          duration_min: 20, equipment: [], blocks: { type: "flow" } })) } });
    }
    if (path.endsWith("/overview")) {
      return route.fulfill({ json: {
        today: TODAY, timezone: "America/Chicago",
        program: { name: "Block 1", week_num: 5, phase: 1 },
        week: { planned: 5, done: 2, sessions: [] },
        today_progress: null, checkin: null,
        strength: { exercises: [] }, checkin_trends: { days: [] },
        patterns: [], flags: [], bodyweight: { points: [] },
        goals: null, sections: {} } });
    }
    if (path.endsWith("/sessions")) return route.fulfill({ json: { days: [] } });
    if (path.endsWith("/plan")) {
      return route.fulfill({ json: { today: TODAY, timezone: "America/Chicago",
        range_from: TODAY, range_to: "2026-10-18", days: [] } });
    }
    if (path.endsWith("/status")) {
      return route.fulfill({ json: { today: TODAY, timezone: "America/Chicago",
        window_days: 14, sessions: [], checkins: [] } });
    }
    return route.fulfill({ json: {} });
  });
}

interface Box { x: number; y: number; width: number; height: number }

function overlaps(a: Box, b: Box): boolean {
  // A shared edge is not an overlap; 1px of tolerance for sub-pixel layout.
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1
      && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

async function navBoxes(page: Page): Promise<Box[]> {
  return page.$$eval(".app-nav a", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
}

/** Every tappable thing that is NOT part of the nav, with its box.
 *
 *  `pinnedOnly` restricts it to `position: fixed | sticky` elements. That
 *  distinction matters once the page is scrolled: ordinary content passing behind
 *  a header on its way out of view is normal, but a PINNED control that overlaps
 *  the nav is permanently untappable — which is precisely what Ryan hit, with
 *  "Steps" sitting behind SESSIONS. */
async function tappableBoxes(
  page: Page, pinnedOnly = false,
): Promise<{ label: string; box: Box }[]> {
  return page.$$eval(
    "button, a, input, select, [role=tab]",
    (els, pinned) => els
      .filter((e) => !e.closest(".app-nav"))
      .filter((e) => {
        if (!pinned) return true;
        for (let n: Element | null = e; n; n = n.parentElement) {
          const pos = getComputedStyle(n as HTMLElement).position;
          if (pos === "fixed" || pos === "sticky") return true;
        }
        return false;
      })
      .filter((e) => {
        const s = getComputedStyle(e);
        if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((e) => {
        const r = e.getBoundingClientRect();
        return {
          label: (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 40),
          box: { x: r.x, y: r.y, width: r.width, height: r.height },
        };
      }),
    pinnedOnly);
}

/** Scroll every scrollable container on the page to its bottom, and report
 *  whether anything actually scrolled.
 *
 *  Each route uses a different container (`.screen--scroll`, `.status`, `.prep`),
 *  so this finds them by behaviour rather than by class — which is also what makes
 *  it survive the next screen someone adds. */
async function scrollAllToBottom(page: Page): Promise<{ scrollers: number; moved: number }> {
  return page.evaluate(() => {
    let scrollers = 0;
    let moved = 0;
    const els: Element[] = [document.scrollingElement!, ...document.querySelectorAll("*")]
      .filter(Boolean) as Element[];
    for (const el of els) {
      if (el.scrollHeight <= el.clientHeight + 1) continue;
      const style = el === document.scrollingElement
        ? null : getComputedStyle(el as HTMLElement);
      if (style && !/(auto|scroll)/.test(style.overflowY)) continue;
      scrollers++;
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      if (el.scrollTop > before) moved++;
    }
    return { scrollers, moved };
  });
}

/** The bottom-most VISIBLE leaf element's box, measured after scrolling.
 *
 *  Leaf, because a container's box tells you nothing about whether its contents
 *  were reachable. Visible, because the first version of this picked an invisible
 *  node and waited on it for ever. */
async function lastVisibleLeafBox(page: Page): Promise<Box | null> {
  return page.evaluate(() => {
    let best: { x: number; y: number; width: number; height: number } | null = null;
    let bestBottom = -Infinity;
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (el.children.length > 0) continue;
      if (el.closest(".app-nav")) continue;
      const st = getComputedStyle(el as HTMLElement);
      if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (!(el.textContent || "").trim()) continue;
      if (r.bottom > bestBottom) {
        bestBottom = r.bottom;
        best = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    return best;
  });
}

async function assertNothingUnderTheNav(page: Page, where: string, pinnedOnly = false) {
  const nav = await navBoxes(page);
  expect(nav.length, "the app nav should be on screen").toBeGreaterThan(0);
  const tappables = await tappableBoxes(page, pinnedOnly);
  const hidden = tappables.filter((t) => nav.some((n) => overlaps(t.box, n)));
  expect(hidden.map((h) => h.label), `${where}: these sit under the nav`).toEqual([]);
}

test.describe("every route: nothing under the nav, and it scrolls", () => {
  for (const route of ROUTES) {
    test(`${route} keeps its controls clear of the nav and reaches its last element`,
      async ({ page }) => {
        await mockApi(page);
        await page.goto(route);
        await page.waitForTimeout(700);

        await assertNothingUnderTheNav(page, `${route} at rest`);

        // (b) the page must reach its own last element.
        const vp = page.viewportSize()!;
        const before = await lastVisibleLeafBox(page);
        const { scrollers, moved } = await scrollAllToBottom(page);
        await page.waitForTimeout(300);
        const after = await lastVisibleLeafBox(page);
        expect(after, `${route}: nothing visible to measure`).not.toBeNull();

        if (before && before.y + before.height > vp.height) {
          // Content overflowed, so something had to scroll. THE BUG: `.prep` was
          // a fixed-height flex column with no overflow, so nothing could.
          expect(scrollers, `${route}: content overflows but nothing scrolls`)
            .toBeGreaterThan(0);
          expect(moved, `${route}: a scrollable container did not move`)
            .toBeGreaterThan(0);
        }
        expect(after!.y, `${route}: last element still below the fold after scrolling`)
          .toBeLessThan(vp.height);

        // and still nothing under the nav once scrolled, which is when sticky
        // elements move and collide.
        await assertNothingUnderTheNav(page, `${route} scrolled to the end`, true);
      });
  }
});

test.describe("prep sub-tabs", () => {
  const TABS = ["Shopping", "Pantry", "Board", "Steps"] as const;

  test("every sub-tab is visible, tappable and clear of the nav", async ({ page }) => {
    await mockApi(page);
    await page.goto("/prep");
    await page.waitForTimeout(700);

    const nav = await navBoxes(page);
    for (const label of TABS) {
      const tab = page.getByRole("tab", { name: label });
      await expect(tab, `${label} tab should exist`).toBeVisible();
      const box = (await tab.boundingBox())!;
      for (const n of nav) {
        expect(overlaps(box, n), `${label} sits under a nav button`).toBe(false);
      }
    }
  });

  test("each sub-tab scrolls to its own last row", async ({ page }) => {
    await mockApi(page);
    await page.goto("/prep");
    await page.waitForTimeout(700);
    for (const label of TABS) {
      await page.getByRole("tab", { name: label }).click();
      await page.waitForTimeout(500);
      await scrollAllToBottom(page);
      await page.waitForTimeout(250);
      const box = await lastVisibleLeafBox(page);
      if (!box) continue;                       // an empty tab has nothing to reach
      expect(box.y, `${label}: last row is below the fold`)
        .toBeLessThan(page.viewportSize()!.height);
      await assertNothingUnderTheNav(page, `prep/${label} scrolled`, true);
    }
  });

  test("figures: the Prep tab inside the real app shell", async ({ page }) => {
    // Into .claude/handoff/figures/ rather than e2e/screenshots/, because these
    // are the proof for the round's report — and unlike the last set, they show
    // the SHELL: the nav, the sub-tabs and the screen's own scroll.
    const FIG = "../artemis/.claude/handoff/figures";
    const orient = test.info().project.name.includes("portrait") ? "portrait" : "landscape";
    await mockApi(page);
    await page.goto("/prep");
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${FIG}/prep-shell-shopping-${orient}.png` });

    await page.getByRole("tab", { name: "Pantry" }).click();
    await page.waitForTimeout(500);
    await scrollAllToBottom(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${FIG}/prep-shell-pantry-scrolled-${orient}.png` });

    await page.getByRole("tab", { name: "Board" }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${FIG}/prep-shell-board-${orient}.png` });
  });

  test("the shopping list's last item is reachable", async ({ page }) => {
    // The bug in Ryan's words: "It doesn't let me scroll down."
    await mockApi(page);
    await page.goto("/prep");
    await page.waitForTimeout(700);
    const lastItem = page.getByText(`Ingredient number ${N_LONG}`);
    await lastItem.scrollIntoViewIfNeeded();
    await expect(lastItem).toBeInViewport();
  });
});
