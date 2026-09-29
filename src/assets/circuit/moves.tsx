import type { ReactNode } from "react";
import { Floor, Head, Limb, Torso } from "../poses/figure";

// ---------------------------------------------------------------------------
// BW-CIRCUIT movement figures — ORIGINAL line drawings for gym-display, built
// on the same primitives as the Recovery Flow poses (400 × 300, floor at 270,
// every stroke currentColor). Nothing is traced or copied.
//
// Each movement is 2 KEY FRAMES, not a tween: a push-up is "top" and "bottom",
// a march is "left knee" and "right knee". Two frames read as the movement at a
// glance and cost nothing to animate — an in-between frame of a push-up looks
// like a different, worse exercise.
//
// The loop is CSS (see styles/circuit.css) so it respects
// prefers-reduced-motion by pinning frame 1.
// ---------------------------------------------------------------------------

export interface Move {
  /** Two key frames, played in order. */
  frames: Array<() => ReactNode>;
  /** Seconds for one full cycle at the drawn tempo. */
  cycle: number;
}

/** The suspension straps a row hangs from. Without them the figure just reads
 * as someone leaning backwards. */
function Straps({ to }: { to: readonly [number, number] }) {
  return (
    <g opacity={0.45}>
      <line x1={196} y1={22} x2={to[0] - 8} y2={to[1]} stroke="currentColor"
            strokeWidth={4} strokeLinecap="round" />
      <line x1={232} y1={22} x2={to[0] + 8} y2={to[1]} stroke="currentColor"
            strokeWidth={4} strokeLinecap="round" />
      <line x1={180} y1={22} x2={248} y2={22} stroke="currentColor"
            strokeWidth={6} strokeLinecap="round" />
    </g>
  );
}

/** Plank-ish base shared by push-up and mountain climber. */
function Ground() {
  return <Floor from={60} to={360} />;
}

export const MOVES: Record<string, Move> = {
  // ── push ────────────────────────────────────────────────────────────────
  "push-up": {
    cycle: 2,
    frames: [
      // top: arms straight, body one line from heels to head
      () => (
        <g>
          <Ground />
          <Limb p={[[150, 186], [150, 262]]} w={13} />
          <Limb p={[[150, 186], [158, 262]]} far />
          <Torso neck={[176, 178]} hip={[262, 206]} />
          <Head at={[160, 172]} />
          <Limb p={[[262, 206], [318, 244], [346, 262]]} />
          <Limb p={[[262, 206], [312, 250], [344, 264]]} far />
        </g>
      ),
      // bottom: elbows bent, chest low, same straight line
      () => (
        <g>
          <Ground />
          <Limb p={[[150, 226], [128, 244], [138, 262]]} w={13} />
          <Limb p={[[150, 226], [132, 246], [144, 262]]} far />
          <Torso neck={[176, 222]} hip={[262, 240]} />
          <Head at={[160, 218]} />
          <Limb p={[[262, 240], [318, 252], [346, 262]]} />
          <Limb p={[[262, 240], [312, 256], [344, 264]]} far />
        </g>
      ),
    ],
  },

  // ── pull (TRX / band row) ───────────────────────────────────────────────
  "row": {
    cycle: 2,
    frames: [
      // arms long, body leaning back off the straps
      () => (
        <g>
          <Floor from={60} to={360} />
          <Straps to={[214, 120]} />
          <Limb p={[[214, 120], [196, 168]]} />
          <Torso neck={[196, 168]} hip={[246, 244]} />
          <Head at={[188, 150]} />
          <Limb p={[[196, 172], [216, 132]]} />
          <Limb p={[[198, 176], [218, 136]]} far />
          <Limb p={[[246, 244], [290, 268]]} />
          <Limb p={[[246, 246], [292, 270]]} far />
        </g>
      ),
      // pulled in: elbows back past the ribs, chest up
      () => (
        <g>
          <Floor from={60} to={360} />
          <Straps to={[214, 120]} />
          <Limb p={[[214, 120], [214, 150]]} />
          <Torso neck={[212, 150]} hip={[250, 240]} />
          <Head at={[206, 132]} />
          <Limb p={[[212, 156], [182, 178], [214, 144]]} />
          <Limb p={[[214, 160], [186, 182], [216, 148]]} far />
          <Limb p={[[250, 240], [292, 268]]} />
          <Limb p={[[250, 242], [294, 270]]} far />
        </g>
      ),
    ],
  },

  // ── legs (reverse lunge) ────────────────────────────────────────────────
  "reverse lunge": {
    cycle: 3,
    frames: [
      // standing tall
      () => (
        <g>
          <Floor />
          <Head at={[200, 96]} />
          <Torso neck={[200, 116]} hip={[200, 190]} />
          <Limb p={[[200, 190], [200, 234], [200, 268]]} />
          <Limb p={[[200, 190], [202, 234], [202, 268]]} far />
          <Limb p={[[200, 126], [188, 174]]} />
          <Limb p={[[200, 126], [212, 174]]} far />
        </g>
      ),
      // back knee down, front shin vertical
      () => (
        <g>
          <Floor />
          <Head at={[200, 120]} />
          <Torso neck={[200, 140]} hip={[200, 208]} />
          <Limb p={[[200, 208], [166, 236], [166, 268]]} />
          <Limb p={[[200, 208], [246, 240], [262, 268]]} far />
          <Limb p={[[200, 150], [186, 196]]} />
          <Limb p={[[200, 150], [214, 196]]} far />
        </g>
      ),
    ],
  },

  // ── core (mountain climber) ─────────────────────────────────────────────
  "mountain climber": {
    cycle: 1.5,
    frames: [
      // Near knee driven UP under the chest, far leg long behind. The first
      // version swapped two similarly-angled legs and the two frames read as
      // the same picture — the knee has to travel a long way to be legible.
      () => (
        <g>
          <Ground />
          <Limb p={[[150, 190], [150, 262]]} />
          <Torso neck={[176, 182]} hip={[262, 208]} />
          <Head at={[160, 176]} />
          <Limb p={[[262, 208], [196, 202], [206, 240]]} />
          <Limb p={[[262, 208], [322, 244], [352, 262]]} far />
        </g>
      ),
      // Swapped: near leg long, far knee up.
      () => (
        <g>
          <Ground />
          <Limb p={[[150, 190], [150, 262]]} />
          <Torso neck={[176, 182]} hip={[262, 208]} />
          <Head at={[160, 176]} />
          <Limb p={[[262, 208], [322, 244], [352, 262]]} />
          <Limb p={[[262, 208], [196, 202], [206, 240]]} far />
        </g>
      ),
    ],
  },

  // ── burst (step-ups) ────────────────────────────────────────────────────
  "step-up": {
    cycle: 2,
    frames: [
      () => (
        <g>
          <Floor />
          {/* the step */}
          <rect x={236} y={238} width={104} height={32} rx={4} fill="currentColor" opacity={0.2} />
          <Head at={[186, 104]} />
          <Torso neck={[186, 124]} hip={[190, 196]} />
          <Limb p={[[190, 196], [188, 234], [188, 268]]} />
          <Limb p={[[190, 196], [244, 214], [262, 238]]} far />
          <Limb p={[[186, 134], [166, 180]]} />
          <Limb p={[[186, 134], [208, 178]]} far />
        </g>
      ),
      () => (
        <g>
          <Floor />
          <rect x={236} y={238} width={104} height={32} rx={4} fill="currentColor" opacity={0.2} />
          <Head at={[248, 78]} />
          <Torso neck={[248, 98]} hip={[256, 168]} />
          <Limb p={[[256, 168], [262, 204], [268, 238]]} />
          <Limb p={[[256, 168], [212, 196], [200, 232]]} far />
          <Limb p={[[248, 110], [222, 152]]} />
          <Limb p={[[248, 110], [274, 150]]} far />
        </g>
      ),
    ],
  },

  // ── active recovery ─────────────────────────────────────────────────────
  "march in place": {
    cycle: 2,
    frames: [
      () => (
        <g>
          <Floor />
          <Head at={[200, 96]} />
          <Torso neck={[200, 116]} hip={[200, 190]} />
          <Limb p={[[200, 190], [176, 222], [178, 258]]} />
          <Limb p={[[200, 190], [204, 230], [204, 268]]} far />
          <Limb p={[[200, 126], [224, 164]]} />
          <Limb p={[[200, 126], [176, 168]]} far />
        </g>
      ),
      () => (
        <g>
          <Floor />
          <Head at={[200, 96]} />
          <Torso neck={[200, 116]} hip={[200, 190]} />
          <Limb p={[[200, 190], [196, 230], [196, 268]]} />
          <Limb p={[[200, 190], [226, 222], [224, 258]]} far />
          <Limb p={[[200, 126], [176, 164]]} />
          <Limb p={[[200, 126], [224, 168]]} far />
        </g>
      ),
    ],
  },

  "jog in place": {
    cycle: 1.2,
    frames: [
      () => (
        <g>
          <Floor />
          <Head at={[200, 88]} />
          <Torso neck={[200, 108]} hip={[200, 184]} />
          <Limb p={[[200, 184], [170, 206], [176, 240]]} />
          <Limb p={[[200, 184], [206, 226], [206, 266]]} far />
          <Limb p={[[200, 118], [232, 148], [228, 118]]} />
          <Limb p={[[200, 118], [168, 150], [172, 120]]} far />
        </g>
      ),
      () => (
        <g>
          <Floor />
          <Head at={[200, 88]} />
          <Torso neck={[200, 108]} hip={[200, 184]} />
          <Limb p={[[200, 184], [194, 226], [194, 266]]} />
          <Limb p={[[200, 184], [230, 206], [224, 240]]} far />
          <Limb p={[[200, 118], [168, 148], [172, 118]]} />
          <Limb p={[[200, 118], [232, 150], [228, 120]]} far />
        </g>
      ),
    ],
  },
};

/** The figure a movement name resolves to, or null when it has none yet. */
export function moveFor(name: string): Move | null {
  const k = name.toLowerCase();
  if (k.includes("push-up")) return MOVES["push-up"];
  if (k.includes("row")) return MOVES["row"];
  if (k.includes("lunge") || k.includes("squat")) return MOVES["reverse lunge"];
  if (k.includes("mountain climber") || k.includes("dead bug")) return MOVES["mountain climber"];
  if (k.includes("step-up") || k.includes("skater")) return MOVES["step-up"];
  if (k.includes("jog")) return MOVES["jog in place"];
  if (k.includes("march")) return MOVES["march in place"];
  return null;
}
