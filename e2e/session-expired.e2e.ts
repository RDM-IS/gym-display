import { expect, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// HARDEN-1 item 6: a lapsed Cloudflare Access session.
// Every /api call answers 401 {"error":"access_required"} (what the proxy
// returns). The app must show the sign-in banner and must NOT lose a set that
// was waiting in the offline queue — not on the failed replay, and not across
// the banner-triggered reload.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "gym_log_queue";
const QUEUED = {
  plan_id: 103,
  exercise: "Leg press",
  log_type: "strength_set",
  sets: [{ set_num: 2, reps_done: 12, weight_lbs: 160, rpe_actual: 7.5, notes: "setting=6" }],
};

test("401 access_required shows the banner and keeps the queued set", async ({ page }) => {
  // Seed one unsynced set exactly once, as if logged offline before the
  // session lapsed. The marker stops the seed re-running on reload, so a set
  // that survives the reload really was retained by the app.
  await page.addInitScript(
    ({ key, body }) => {
      if (sessionStorage.getItem("__e2e_seeded")) return;
      sessionStorage.setItem("__e2e_seeded", "1");
      sessionStorage.setItem(key, JSON.stringify([body]));
    },
    { key: STORAGE_KEY, body: QUEUED }
  );

  let logPosts = 0;
  await page.route("**/api/health/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/log")) logPosts += 1;
    await route.fulfill({ status: 401, json: { error: "access_required" } });
  });

  await page.goto("/today");

  const banner = page.getByRole("alert");
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText("Session expired — tap to sign in");

  // Full-width across the top, and a real touch target.
  const box = await banner.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(viewport.width);
  expect(Math.round(box!.y)).toBe(0);
  expect(box!.height).toBeGreaterThanOrEqual(56);

  // The replay was attempted at most once, then held — no retry loop.
  await page.waitForTimeout(3000);
  expect(logPosts).toBeLessThanOrEqual(1);

  const kept = await page.evaluate((k) => sessionStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(kept!)).toEqual([QUEUED]);

  // The sync badge still counts it.
  await expect(page.getByText("1 unsynced")).toBeVisible();

  // Nothing is hidden under the banner: nav and badges start below it.
  const bannerBottom = box!.y + box!.height;
  for (const sel of [".app-nav", ".floating-badges"]) {
    const r = await page.locator(sel).boundingBox();
    expect(r, sel).not.toBeNull();
    expect(r!.y, `${sel} overlaps the banner`).toBeGreaterThanOrEqual(bannerBottom);
  }
  await expect(page.getByText("Signed out")).toBeVisible();
  await expect(page.getByText("session_expired")).toHaveCount(0);

  const project = test.info().project.name;
  await page.screenshot({ path: `e2e/screenshots/${project}-session-expired.png` });

  // Tap → full reload. Access would sign in here; the mock still says expired.
  await Promise.all([page.waitForEvent("load"), banner.click()]);
  await expect(page.getByRole("alert")).toBeVisible();
  const afterReload = await page.evaluate((k) => sessionStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(afterReload!)).toEqual([QUEUED]);
});

test("after sign-in the retained set is sent and the banner is gone", async ({ page }) => {
  await page.addInitScript(
    ({ key, body }) => {
      if (sessionStorage.getItem("__e2e_seeded")) return;
      sessionStorage.setItem("__e2e_seeded", "1");
      sessionStorage.setItem(key, JSON.stringify([body]));
    },
    { key: STORAGE_KEY, body: QUEUED }
  );

  const posted: unknown[] = [];
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/log")) {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { plan_id: 103, inserted: 1, rows: [] } });
    }
    if (path.endsWith("/today")) {
      return route.fulfill({ status: 404, json: { error: "no_plan", fallback: "rest day" } });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto("/today");
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toEqual(QUEUED);
  await expect(page.getByRole("alert")).toHaveCount(0);
  const left = await page.evaluate((k) => sessionStorage.getItem(k), STORAGE_KEY);
  expect(JSON.parse(left!)).toEqual([]);
});
