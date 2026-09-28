// EXTRA-FIGURES self-review: every Extras figure on its own, at the size it
// occupies on the iPad, rendered by the real browser engine.
//
//   npx vite-node scripts/extra-figure-pngs.tsx [outDir]
//
// Size: 880x660 = 2x the ~440x330 CSS box .flow-figure gets on an iPad in
// landscape (height 40dvh, max-width 4/3 of that), so a Retina device pixel is a
// PNG pixel.
//
// THE APP IS DARK-ONLY — one token set, `color-scheme: dark`, no
// prefers-color-scheme light branch (src/styles/base.css). So `-dark` is the
// shipped appearance and `-light` is a LEGIBILITY CHECK for the inverse, which is
// worth having because every stroke is `currentColor`: if a light theme ever
// arrives these figures follow it, and thin strokes are where that goes wrong.
import { mkdirSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { webkit } from "@playwright/test";
import PoseFigure from "../src/assets/poses";
import { DRAWINGS } from "../src/assets/poses/drawings";

const OUT = process.argv[2] ?? "../artemis/.claude/handoff/figures";
const W = 880;
const H = 660;

/** The Extras: YOGA-6's new poses, Core, Mobility. */
const NAMES = [
  "chair", "plank", "warrior ii", "warrior iii", "low lunge twist",
  "dead bug", "bird dog", "side plank", "glute bridge", "mcgill curl-up",
  "cat-cow", "90/90 hip switch", "half-kneeling hip flexor stretch",
  "thread the needle", "ankle rocks", "child's pose",
];

const THEMES = {
  dark: { bg: "#0a0a0a", fg: "#f5f5f5" },     // the app's real tokens
  light: { bg: "#ffffff", fg: "#141414" },    // inverse legibility check
} as const;

function page(svg: string, bg: string, fg: string): string {
  return `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:${bg};color:${fg}}
  .pose-figure{width:${W}px;height:${H}px}
  .pose-figure svg{display:block;width:100%;height:100%}
  </style>${svg}`;
}

mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const written: string[] = [];
for (const name of NAMES) {
  const d = DRAWINGS[name];
  if (!d) throw new Error(`no drawing for ${name}`);
  // Sided figures render R (the base) here; mirroring is checked on the sheet.
  const svg = renderToStaticMarkup(<PoseFigure name={name} side={d.sided ? "R" : null} />);
  for (const [theme, { bg, fg }] of Object.entries(THEMES)) {
    const p = `${OUT}/${name.replace(/[^a-z0-9]+/g, "-")}-${theme}.png`;
    const pg = await browser.newPage({ viewport: { width: W, height: H } });
    await pg.setContent(page(svg, bg, fg));
    await pg.screenshot({ path: p });
    await pg.close();
    written.push(p);
  }
}

// One sheet per theme, R and L together, so mirroring is checked once.
for (const [theme, { bg, fg }] of Object.entries(THEMES)) {
  const cells = NAMES.flatMap((name) => {
    const d = DRAWINGS[name];
    return (d.sided ? (["R", "L"] as const) : [null]).map((side) => {
      const svg = renderToStaticMarkup(<PoseFigure name={name} side={side} />);
      return `<figure>${svg}<figcaption>${name}${side ? ` · ${side}` : ""}</figcaption></figure>`;
    });
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
  body{background:${bg};color:${fg};font:15px system-ui;margin:16px;display:grid;
  grid-template-columns:repeat(4,330px);gap:14px}
  figure{margin:0;border:1px solid currentColor;border-radius:8px;opacity:.999}
  .pose-figure svg{display:block;width:330px;height:248px}
  figcaption{padding:5px 9px;opacity:.75}</style>${cells.join("")}`;
  const p = `${OUT}/_sheet-${theme}.png`;
  const pg = await browser.newPage({ viewport: { width: 1420, height: 900 } });
  await pg.setContent(html);
  await pg.screenshot({ path: p, fullPage: true });
  await pg.close();
  written.push(p);
}
await browser.close();
console.log(written.join("\n"));
console.log(`${written.length} files -> ${OUT}`);
