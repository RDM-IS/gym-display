// MUSIC-1 design review: the player collapsed and expanded, on the app's own
// background, as one HTML page + two WebKit screenshots.
//   npx vite-node scripts/music-shot.tsx
//
// Rendered from the REAL component with renderToStaticMarkup, so what is shown
// is what ships. The toggle interaction itself is covered by tests/music.test.tsx
// (which proves the iframe element survives collapsing); this script is about how
// it looks, at iPad width and at phone width.
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { webkit } from "@playwright/test";
import MusicPlayer from "../src/components/MusicPlayer";
import FlowScreen from "../src/screens/FlowScreen";
import { readFileSync } from "node:fs";

// The REAL Flow screen, from the real fixture, so the shot shows the player in
// the place it actually lives rather than on its own.
const flowPlan = JSON.parse(readFileSync("tests/fixtures/recovery-flow-office.json", "utf8"));

const base = readFileSync("src/styles/base.css", "utf8");
const music = readFileSync("src/styles/music.css", "utf8");

function panel(title: string, expanded: boolean): string {
  // The frame has to be tall enough for the state it holds: the real player is
  // pinned to the bottom of the viewport, so an undersized box here clips it
  // upward and makes a harness bug look like a layout bug.
  return `<section class="shot">
    <h2>${title}</h2>
    <div class="frame" style="min-height:${expanded ? 300 : 150}px">${renderToStaticMarkup(
      <MusicPlayer sessionType="recovery_flow" defaultExpanded={expanded} />,
    )}</div>
  </section>`;
}

const html = `<!doctype html><meta charset="utf-8">
<style>
${base}
${music}
/* The real player is position:fixed. Pinned into a box here so both states can
   be seen at once; nothing else about it is overridden. */
.frame { position: relative; border: 1px solid var(--line);
         border-radius: 10px; overflow: hidden; background: var(--bg); }
.frame .music { position: absolute; }
.frame--screen { min-height: 520px; }
.frame--screen .screen { position: static; padding: 14px; }
html, body, #root { height: auto; overflow: visible; }
body { background: #0a0a0a; color: #f5f5f5; font: 14px system-ui; margin: 18px; }
h1 { font-size: 17px; font-weight: 600; }
h2 { font-size: 13px; font-weight: 500; color: rgba(245,245,245,.72); margin: 18px 0 6px; }
.note { color: rgba(245,245,245,.5); font-size: 12px; max-width: 60ch; }
</style>
<h1>MUSIC-1 — Apple Music on the Flow and circuit screens</h1>
<p class="note">Collapsed is the default. The embed is mounted on first expand and
kept in the tree from then on, hidden with <code>[hidden]</code> — collapsing must
not stop playback.</p>
${panel("Collapsed — one tap tall", false)}
${panel("Expanded — Apple Music embed", true)}
<h2>On the Flow screen itself — collapsed</h2>
<div class="frame frame--screen">${(() => {
  try {
    return renderToStaticMarkup(<FlowScreen plan={flowPlan.plan ?? flowPlan} />);
  } catch (err) {
    return `<p class="note">Flow screen did not render offline: ${String(err).slice(0, 200)}</p>`;
  }
})()}</div>
`;

mkdirSync("e2e/screenshots", { recursive: true });
writeFileSync("e2e/screenshots/music-1.html", html);

const browser = await webkit.launch();
for (const [name, width] of [["ipad", 820], ["phone", 390]] as const) {
  const page = await browser.newPage({ viewport: { width, height: 700 } });
  await page.setContent(html);
  // The embed is a real Apple Music iframe; give it a moment, but do not fail
  // the shot if the network is unavailable -- the layout is what is under review.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `e2e/screenshots/music-1-${name}.png`, fullPage: true });
  await page.close();
  console.log(`wrote e2e/screenshots/music-1-${name}.png (${width}px)`);
}
await browser.close();
