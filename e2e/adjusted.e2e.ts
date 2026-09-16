import { expect, test } from "@playwright/test";

// FRIDAY-1: a Session B that Artemis adjusted after "sore shoulder 4, quads sore 3".
const ADJUSTED = {
  plan_id: 105,
  plan_date: "2026-09-18",
  phase: 1,
  week_num: 1,
  session_type: "strength_b",
  target_rpe: 6,
  est_duration_min: 45,
  is_skipped: false,
  blocks: {
    type: "circuit",
    display_name: "Office Strength B",
    location: "office gym",
    rounds: 2,
    warmup: "5 min elliptical, easy",
    cooldown: "5 min Stretch Trainer",
    rest_between_rounds_sec: 90,
    equipment: ["leg press", "leg curl", "calf press", "leg extension", "captain's chair"],
    exercises: [
      { name: "Leg press", format: "reps", target_reps: 12, notes: "2×10-12", added_by: "checkin", replaces: "DB goblet squat" },
      { name: "Seated leg curl", format: "reps", target_reps: 12, notes: "2×10-12", added_by: "checkin", replaces: "Seated cable row" },
      { name: "Calf press", format: "reps", target_reps: 15, notes: "2×12-15", added_by: "checkin", replaces: "Incline DB press" },
      { name: "Leg extension", format: "reps", target_reps: 12, notes: "1×10-12", sets: 1, rpe_cap: 5 },
      { name: "Captain's chair knee raise", format: "reps", target_reps: 12, notes: "2×8-12", added_by: "checkin", replaces: "Rear delt fly" },
      { name: "Cable Pallof press", format: "reps", target_reps: 10, notes: "2×10 each side" },
      { name: "45° back extension", format: "reps", target_reps: 12, notes: "2×10-12" },
    ],
    adjustment: {
      rules_fired: ["replace", "ease"],
      removed: ["DB goblet squat", "Seated cable row", "Incline DB press", "Rear delt fly"],
      added: ["Leg press", "Seated leg curl", "Calf press", "Captain's chair knee raise"],
      eased: ["Leg extension"],
      summary: [
        "Shoulder 4/5 → removed DB goblet squat, seated cable row, incline DB press, rear delt fly. Added leg press, seated leg curl, calf press, captain's chair knee raise.",
        "Quads 3/5 → leg extension: 1 set, RPE ≤5.",
      ],
    },
  },
};

test("adjusted plan: banner, badges, details — all touchable", async ({ page }) => {
  await page.route("**/api/health/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/today")) return route.fulfill({ json: ADJUSTED });
    if (path.endsWith("/status")) {
      return route.fulfill({ json: {
        today: "2026-09-18", window_start: "2026-09-13", window_end: "2026-09-23",
        today_summary: { plan_id: 105, session_type: "strength_b", is_skipped: false, is_logged: false, exists: true },
        banner: { phase: 1, week_num: 1, phase_name: "Foundation", as_of_date: "2026-09-18" },
        day_strip: [], most_recent_session: null, same_type_history: [], rpe_trend: [], weight_trend: [],
      } });
    }
    if (path.endsWith("/today/logged")) return route.fulfill({ json: { plan_id: 105, exercises: [], has_session_summary: false } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/today");
  const banner = page.getByRole("button", { name: /Adjusted: shoulder 4\/5 — tap for details/ });
  await expect(banner).toBeVisible();
  const box = await banner.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(56);

  const exerciseRow = (name: string) =>
    page.locator("li", { has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) });
  const legExt = exerciseRow("Leg extension");
  await expect(legExt).toContainText("1 set × ");
  await expect(legExt).toContainText("RPE ≤5");
  await expect(exerciseRow("Leg press")).toContainText("added (for DB goblet squat)");
  await expect(page.getByText("Rear delt fly", { exact: true })).toHaveCount(0);

  const project = test.info().project.name;
  await page.screenshot({ path: `e2e/screenshots/${project}-adjusted-setup.png` });

  await banner.tap();
  await expect(page.getByText(/Removed:/)).toBeVisible();
  await expect(page.getByText(/Reply/)).toContainText("original");
  await page.screenshot({ path: `e2e/screenshots/${project}-adjusted-details.png` });
});
