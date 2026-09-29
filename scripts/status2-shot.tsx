// STATUS-2 design review — the REAL StatusScreen, landscape / portrait /
// degraded.
//   npx vite-node scripts/status2-shot.tsx
//
// StatusScreen fetches in an effect, so renderToStaticMarkup alone only ever
// produces "Loading…". This renders the true component tree in jsdom with
// global fetch stubbed, waits for the effect, and screenshots the resulting DOM
// in WebKit. What you see is what the screen renders, not a re-composition of
// its parts.
//
// PUBLIC-FIXTURES: every value below is synthetic and outside the real range.
// Status is the one page where every health number meets, and both repos are
// public.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { webkit } from "@playwright/test";
import type { OverviewResponse } from "../src/lib/types";

const OK = { ok: true, reason: null };

const base = JSON.parse(readFileSync("tests/fixtures/overview.json", "utf8")) as OverviewResponse;

const goals = {
  weight: { section: OK, avg_7d: 999.4, change_since_start: -9.9, lb_per_week: -1.11, days_7d: 5 },
  cardio: {
    section: OK, minutes_this_week: 62, minutes_target: 150, z2_minutes: 48, z4_minutes: 14,
    has_zone_data: true, interval_gate: "z2_variant" as const,
    interval_gate_reason: "you haven't sent `intervals cleared` yet; only 1 of the last 6 cardio sessions are logged",
    interval_gate_date: "2099-01-17",
  },
  strength: { section: OK, sessions_done: 3, sessions_planned: 5, lifts_progressed_14d: 4 },
  nutrition: {
    section: OK, days_logged: 4, days_window: 7, avg_protein_g: 118, avg_fiber_g: 21,
    target_protein_g: null, target_fiber_g: null, target_set_by: null,
  },
};
const cardio_detail = {
  section: OK,
  weeks: [{ week_start: "2099-01-04", minutes: 95, sessions: 3 },
          { week_start: "2099-01-11", minutes: 62, sessions: 2 }],
  resting_hr: [{ date: "2099-01-10", value: 99 }, { date: "2099-01-11", value: 98 },
               { date: "2099-01-12", value: 97 }, { date: "2099-01-13", value: 98 }],
};
const nutrition_7d = {
  section: OK,
  days: ["2099-01-07", "2099-01-08", "2099-01-09", "2099-01-10", "2099-01-11", "2099-01-12", "2099-01-13"]
    .map((day, i) => i % 3 === 2
      ? { day, kcal: null, protein_g: null, fiber_g: null, items: 0 }
      : { day, kcal: 2100 + i * 10, protein_g: 110 + i, fiber_g: 20 + i, items: 4 }),
};
const sleep_recovery = {
  section: OK,
  days: ["2099-01-08", "2099-01-09", "2099-01-10", "2099-01-11", "2099-01-12", "2099-01-13"]
    .map((day, i) => ({ day, sleep_hrs: 6 + (i % 3) * 0.5, resting_hr: 99 - (i % 3), energy: 3 + (i % 3) })),
};

const healthy = { ...base, goals, cardio_detail, nutrition_7d, sleep_recovery };
// ONE status per domain: degrading nutrition degrades the tile AND the section
// below it, which is what the Lambda now returns. The round-#17 shot degraded
// only the tile's key and showed them disagreeing.
const down = { ok: false, reason: "couldn't read nutrition" };
const degraded = {
  ...healthy,
  goals: { ...goals, nutrition: { ...goals.nutrition, section: down } },
  nutrition_7d: { section: down, days: [] },
};

async function renderScreen(data: OverviewResponse): Promise<string> {
  const dom = new JSDOM("<!doctype html><div id=\"root\"></div>", {
    url: "https://gym.rdm.is/", pretendToBeVisual: true,
  });
  const g = globalThis as Record<string, unknown>;
  for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node",
                   "localStorage", "getComputedStyle", "requestAnimationFrame",
                   "cancelAnimationFrame", "MutationObserver", "CustomEvent", "Event"]) {
    g[k] = (dom.window as unknown as Record<string, unknown>)[k];
  }
  g.IS_REACT_ACT_ENVIRONMENT = true;
  g.fetch = async () =>
    ({ ok: true, status: 200, json: async () => data }) as unknown as Response;

  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const StatusScreen = (await import("../src/screens/StatusScreen")).default;
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(<StatusScreen onNavigate={() => {}} />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const html = dom.window.document.getElementById("root")!.innerHTML;
  if (html.includes("Loading…")) throw new Error("StatusScreen never left its loading state");
  return html;
}

const css = ["base.css", "status2.css", "week.css", "music.css"]
  .map((f) => readFileSync(`src/styles/${f}`, "utf8")).join("\n");

function page(body: string, label: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
${css}
/* The screen is position:fixed under the real tab bar; pinned static here so
   fullPage captures all of it. Nothing else is overridden. */
html, body { height: auto; overflow: visible; background: #0a0a0a; }
.status2 { position: static; padding: 12px 14px 20px; }
.music { display: none; }            /* the player belongs to the workout screens */
/* BottomBar is position:fixed against the viewport; in a fullPage capture it
   lands in the middle of the image. It is chrome, not the page under review. */
.bottom-bar, [data-testid="bottom-bar"] { display: none !important; }
h1.shot { font: 600 15px system-ui; color: rgba(245,245,245,.72); margin: 12px 14px 0; }
</style><h1 class="shot">STATUS-2 — ${label}</h1>${body}`;
}

const OUT = process.env.STATUS2_OUT || "e2e/screenshots";
mkdirSync(OUT, { recursive: true });
mkdirSync("e2e/screenshots", { recursive: true });

const browser = await webkit.launch();
const shots: Array<[string, number, number, OverviewResponse, string]> = [
  ["landscape", 1180, 820, healthy, "iPad landscape — both columns carry sections"],
  ["portrait", 820, 1180, healthy, "iPad portrait — tiles 2×2"],
  ["degraded", 820, 1180, degraded, "nutrition unreadable — tile AND section agree"],
];
for (const [name, w, h, data, label] of shots) {
  const body = await renderScreen(data);
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(page(body, label));
  await p.screenshot({ path: `${OUT}/status2-${name}.png`, fullPage: true });
  await p.close();
  console.log(`wrote ${OUT}/status2-${name}.png (${w}x${h})`);
  if (name === "landscape") writeFileSync("e2e/screenshots/status2.html", page(body, label));
}
await browser.close();
