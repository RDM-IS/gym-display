// BW-CIRCUIT design review: every movement, both key frames, at iPad size.
//   npx vite-node scripts/circuit-sheet.tsx
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { webkit } from "@playwright/test";
import { MOVES } from "../src/assets/circuit/moves";
import { VIEW_H, VIEW_W } from "../src/assets/poses/figure";

const cells: string[] = [];
for (const [name, move] of Object.entries(MOVES)) {
  for (const [i, frame] of move.frames.entries()) {
    const svg = `<svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="300">${
      renderToStaticMarkup(frame())}</svg>`;
    cells.push(`<figure>${svg}<figcaption>${name} · frame ${i + 1}</figcaption></figure>`);
  }
}
const base = readFileSync("src/styles/base.css", "utf8");
const html = `<!doctype html><meta charset="utf-8"><style>
${base}
html, body { height: auto; overflow: visible; }
body { background:#0a0a0a; color:#f5f5f5; font:14px system-ui; margin:16px;
       display:grid; grid-template-columns:repeat(2, 300px); gap:12px; }
figure { margin:0; border:1px solid rgba(245,245,245,.18); border-radius:8px; }
figcaption { font-size:12px; padding:4px 8px; color:rgba(245,245,245,.72); }
h1 { grid-column:1/-1; font-size:15px; margin:0 0 4px; }
</style><h1>BW-CIRCUIT movement figures — 2 key frames each (draft)</h1>
${cells.join("")}`;

const OUT = process.env.CIRCUIT_OUT || "e2e/screenshots";
mkdirSync(OUT, { recursive: true });
mkdirSync("e2e/screenshots", { recursive: true });
writeFileSync("e2e/screenshots/circuit.html", html);
const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 660, height: 900 } });
await page.setContent(html);
await page.screenshot({ path: `${OUT}/circuit-moves.png`, fullPage: true });
await browser.close();
console.log(`wrote ${OUT}/circuit-moves.png`);
