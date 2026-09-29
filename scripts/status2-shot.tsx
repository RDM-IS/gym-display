// STATUS-2 design review: the goal tiles and detail sections at landscape and
// portrait iPad sizes.
//   npx vite-node scripts/status2-shot.tsx
//
// Rendered from the REAL components. All data here is SYNTHETIC and outside the
// real range (PUBLIC-FIXTURES) — artemis and gym-display are public, and this
// page is the one place every health number meets in one view.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { webkit } from "@playwright/test";
import GoalTiles from "../src/components/GoalTiles";
import {
  CardioDetailSection, NutritionDetailSection, SleepRecoverySection,
} from "../src/components/StatusDetail";
import type { CardioDetail, Goals, NutritionDetail, SleepRecovery } from "../src/lib/types";

const OK = { ok: true, reason: null };

const goals: Goals = {
  weight: { section: OK, avg_7d: 999.4, change_since_start: -9.9, lb_per_week: -1.11, days_7d: 5 },
  cardio: {
    section: OK, minutes_this_week: 62, minutes_target: 150, z2_minutes: 48, z4_minutes: 14,
    has_zone_data: true, interval_gate: "z2_variant",
    interval_gate_reason: "you haven't sent `intervals cleared` yet; only 1 of the last 6 cardio sessions are logged",
    interval_gate_date: "2099-01-17",
  },
  strength: { section: OK, sessions_done: 3, sessions_planned: 5, lifts_progressed_14d: 4 },
  // Deliberately the real-world case: no dietitian target exists.
  nutrition: {
    section: OK, days_logged: 4, days_window: 7, avg_protein_g: 118, avg_fiber_g: 21,
    target_protein_g: null, target_fiber_g: null, target_set_by: null,
  },
};

// One section deliberately unreadable, because that state is the point of the
// design and the easiest one to get wrong.
const goalsDegraded: Goals = {
  ...goals,
  nutrition: { ...goals.nutrition, section: { ok: false, reason: "couldn't read nutrition" } },
};

const cardioDetail: CardioDetail = {
  section: OK,
  weeks: [
    { week_start: "2099-01-04", minutes: 95, sessions: 3 },
    { week_start: "2099-01-11", minutes: 62, sessions: 2 },
  ],
  resting_hr: [
    { date: "2099-01-10", value: 99 }, { date: "2099-01-11", value: 98 },
    { date: "2099-01-12", value: 97 }, { date: "2099-01-13", value: 98 },
  ],
};

const nutrition7d: NutritionDetail = {
  section: OK,
  days: ["2099-01-07", "2099-01-08", "2099-01-09", "2099-01-10", "2099-01-11", "2099-01-12", "2099-01-13"]
    .map((day, i) => i % 3 === 2
      ? { day, kcal: null, protein_g: null, fiber_g: null, items: 0 }
      : { day, kcal: 2100 + i * 10, protein_g: 110 + i, fiber_g: 20 + i, items: 4 }),
};

const sleep: SleepRecovery = {
  section: OK,
  days: ["2099-01-08", "2099-01-09", "2099-01-10", "2099-01-11", "2099-01-12", "2099-01-13"]
    .map((day, i) => ({ day, sleep_hrs: 6 + (i % 3) * 0.5, resting_hr: 99 - (i % 3), energy: 3 + (i % 3) })),
};

function section(title: string, subtitle: string, body: string): string {
  return `<section class="st-section"><h2 class="section-title">${title}</h2>
    <div class="section-sub">${subtitle}</div>${body}</section>`;
}

const page = (g: Goals) => `
<div class="status2">
${renderToStaticMarkup(<GoalTiles goals={g} />)}
<div class="status-grid"><div class="status-col">
${section("Cardio", "weekly minutes and resting HR",
  renderToStaticMarkup(<CardioDetailSection detail={cardioDetail} />))}
${section("Nutrition", "last 7 days",
  renderToStaticMarkup(<NutritionDetailSection detail={nutrition7d} />))}
${section("Sleep &amp; recovery", "sleep, resting HR, energy",
  renderToStaticMarkup(<SleepRecoverySection detail={sleep} />))}
${section("Strength progress", "top set by load × reps",
  `<details class="st-collapse"><summary>6 exercises — show table</summary></details>`)}
</div></div></div>`;

const css = ["base.css", "status2.css"].map((f) => readFileSync(`src/styles/${f}`, "utf8")).join("\n");
const html = (g: Goals, label: string) => `<!doctype html><meta charset="utf-8"><style>
${css}
html, body, #root { height: auto; overflow: visible; }
.status2 { position: static; }
body { background: #0a0a0a; color: #f5f5f5; font: 15px system-ui; margin: 0; padding: 14px; }
h1 { font-size: 15px; font-weight: 600; margin: 0 0 12px; color: rgba(245,245,245,.72); }
.section-title { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
                 color: rgba(245,245,245,.72); margin: 18px 0 2px; }
.section-sub { font-size: 12px; color: rgba(245,245,245,.5); margin-bottom: 6px; }
.st-facts { list-style: none; margin: 4px 0 0; padding: 0; font-size: 14px; }
.st-facts li { padding: 2px 0; }
.dim { color: rgba(245,245,245,.5); }
.muted { color: rgba(245,245,245,.5); font-size: 14px; }
</style><h1>STATUS-2 — ${label}</h1>${page(g)}`;

mkdirSync("e2e/screenshots", { recursive: true });
const OUT = process.env.STATUS2_OUT || "e2e/screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await webkit.launch();
const shots: Array<[string, number, number, Goals, string]> = [
  ["landscape", 1180, 820, goals, "iPad landscape — all four readable"],
  ["portrait", 820, 1180, goals, "iPad portrait — all four readable"],
  ["degraded", 820, 1180, goalsDegraded, "iPad portrait — nutrition unreadable"],
];
for (const [name, w, h, g, label] of shots) {
  const page_ = await browser.newPage({ viewport: { width: w, height: h } });
  await page_.setContent(html(g, label));
  await page_.screenshot({ path: `${OUT}/status2-${name}.png`, fullPage: true });
  await page_.close();
  console.log(`wrote ${OUT}/status2-${name}.png (${w}x${h})`);
}
await browser.close();
writeFileSync("e2e/screenshots/status2.html", html(goals, "reference"));
