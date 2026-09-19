// Design review: every pose figure at 320 px wide (R and L for sided poses) on
// the app's background, as one HTML page + a WebKit screenshot.
//   npx vite-node scripts/pose-sheet.tsx  →  e2e/screenshots/pose-sheet.png
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { webkit } from "@playwright/test";
import PoseFigure from "../src/assets/poses";
import { DRAWINGS } from "../src/assets/poses/drawings";

const cells: string[] = [];
for (const [key, d] of Object.entries(DRAWINGS)) {
  for (const side of d.sided ? (["R", "L"] as const) : [null]) {
    const svg = renderToStaticMarkup(<PoseFigure name={key} side={side} />);
    cells.push(`<figure>${svg}<figcaption>${key}${side ? ` · ${side}` : ""}</figcaption></figure>`);
  }
}
const html = `<!doctype html><meta charset="utf-8"><style>
body{background:#0a0a0a;color:#f5f5f5;font:14px system-ui;margin:16px;display:grid;
grid-template-columns:repeat(4,320px);gap:14px}
figure{margin:0;border:1px solid rgba(245,245,245,.18);border-radius:8px}
.pose-figure svg{display:block;width:320px;height:240px}
figcaption{padding:4px 8px;color:rgba(245,245,245,.72)}</style>${cells.join("")}`;
writeFileSync("e2e/.results/pose-sheet.html", html);
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
await page.setContent(html);
await page.screenshot({ path: "e2e/screenshots/pose-sheet.png", fullPage: true });
await browser.close();
console.log(`${cells.length} figures → e2e/screenshots/pose-sheet.png`);
