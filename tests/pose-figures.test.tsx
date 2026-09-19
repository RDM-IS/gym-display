import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PoseFigure, { TEXT_ONLY, hasPoseArt, isSidedArt, poseKey } from "../src/assets/poses";
import { DRAWINGS } from "../src/assets/poses/drawings";
import FlowScreen from "../src/screens/FlowScreen";
import type { Plan, RecoveryFlowBlocks } from "../src/lib/types";
import home from "./fixtures/recovery-flow-home.json";
import office from "./fixtures/recovery-flow-office.json";
import drawingsSrc from "../src/assets/poses/drawings.tsx?raw";
import figureSrc from "../src/assets/poses/figure.tsx?raw";

const HOME = home.blocks as unknown as RecoveryFlowBlocks;
const OFFICE = office.blocks as unknown as RecoveryFlowBlocks;

// YOGA-2 — pose illustrations.

function flowNames(blocks: RecoveryFlowBlocks): string[] {
  return [
    ...(blocks.pre ?? []).map((p) => p.name),
    ...blocks.flow.map((s) => s.name),
    ...(blocks.close ? [blocks.close.name] : []),
  ];
}

const ALL_NAMES = [...new Set([
  ...flowNames(HOME),
  ...flowNames(OFFICE),
])];

describe("every pose in the flow resolves to an asset", () => {
  it("covers all 16 screens: 14 poses + Stretch Trainer + breathing", () => {
    expect(ALL_NAMES).toHaveLength(16);
    const missing = ALL_NAMES.filter((n) => !(poseKey(n) in DRAWINGS));
    expect(missing, `no drawing for: ${missing.join(", ")}`).toEqual([]);
  });

  it("nothing is on the text-only fallback list today", () => {
    expect(TEXT_ONLY).toEqual({});
    for (const n of ALL_NAMES) expect(hasPoseArt(n), n).toBe(true);
  });

  it("every one-sided step in the flow has a mirrorable drawing", () => {
    const sided = [...HOME.flow]
      .filter((s) => s.side).map((s) => s.name);
    for (const n of new Set(sided)) expect(isSidedArt(n), n).toBe(true);
    // …and nothing two-sided is marked sided.
    for (const s of HOME.flow.filter((f) => !f.side)) {
      expect(isSidedArt(s.name), s.name).toBe(false);
    }
  });
});

describe("mirroring", () => {
  it("side L mirrors a one-sided pose; R is the base drawing", () => {
    const { rerender } = render(<PoseFigure name="High lunge" side="R" />);
    const fig = () => screen.getByTestId("pose-figure");
    expect(fig().dataset.mirrored).toBe("false");
    expect(fig().querySelector("g[transform]")).toBeNull();

    rerender(<PoseFigure name="High lunge" side="L" />);
    expect(fig().dataset.mirrored).toBe("true");
    expect(fig().querySelector("svg > g")?.getAttribute("transform")).toBe("translate(400 0) scale(-1 1)");
  });

  it("a two-sided pose never mirrors", () => {
    render(<PoseFigure name="Downward dog" side="L" />);
    expect(screen.getByTestId("pose-figure").dataset.mirrored).toBe("false");
  });

  it("lookup ignores case and surrounding space", () => {
    render(<PoseFigure name="  high LUNGE " side="L" />);
    expect(screen.getByTestId("pose-figure").dataset.pose).toBe("high lunge");
  });
});

describe("text-only fallback", () => {
  it("a pose with no drawing renders nothing", () => {
    const { container } = render(<PoseFigure name="Handstand" />);
    expect(container.innerHTML).toBe("");
  });

  it("a flow step with no drawing keeps the text-only layout", () => {
    const blocks = structuredClone(HOME);
    blocks.flow[0] = { ...blocks.flow[0], name: "Handstand" };
    const plan = { ...home, blocks } as unknown as Plan;
    render(<FlowScreen plan={plan} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    return screen.findByTestId("flow-body").then((body) => {
      expect(body.className).toBe("flow-body");
      expect(body.querySelector('[data-testid="pose-figure"]')).toBeNull();
      expect(screen.getByTestId("flow-name").textContent).toBe("Handstand");
    });
  });
});

describe("drawings", () => {
  const src = `${drawingsSrc}\n${figureSrc}`;

  it("use currentColor only — no fixed colours, so they follow the theme", () => {
    expect(src).toContain("currentColor");   // really read the sources
    expect(src).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(src).not.toMatch(/\brgba?\(/i);
    expect(src).not.toMatch(/\b(fill|stroke)="(?!none|currentColor)[^"]+"/);
  });

  it("are 4:3", () => {
    render(<PoseFigure name="Cobra" />);
    expect(screen.getByTestId("pose-figure").querySelector("svg")?.getAttribute("viewBox"))
      .toBe("0 0 400 300");
  });

  it("add no tap targets (the flow stays hands-free)", () => {
    const { container } = render(<>{Object.keys(DRAWINGS).map((k) => <PoseFigure key={k} name={k} />)}</>);
    expect(container.querySelectorAll("button, a, [role=button], [onclick], [tabindex]")).toHaveLength(0);
  });
});

describe("flow screen", () => {
  it("the active pose shows its figure above the text", async () => {
    render(<FlowScreen plan={home as unknown as Plan} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const body = await screen.findByTestId("flow-body");
    expect(body.className).toBe("flow-body flow-body--figure");
    const fig = body.querySelector('[data-testid="pose-figure"]') as HTMLElement;
    expect(fig.dataset.pose).toBe("child's pose");
    // Figure first, then the text column.
    expect(body.firstElementChild).toBe(fig);
  });

  it("the ready list has a thumbnail slot on every row", () => {
    render(<FlowScreen plan={home as unknown as Plan} />);
    const rows = screen.getByTestId("flow-ready").querySelectorAll(".flow-list li");
    const withSlot = [...rows].filter((li) => li.querySelector(".flow-thumb-slot"));
    expect(withSlot).toHaveLength(21);   // 20 round-1 poses + breathing
    expect(screen.getByTestId("flow-ready").querySelectorAll('[data-testid="pose-figure"]')).toHaveLength(21);
  });
});
