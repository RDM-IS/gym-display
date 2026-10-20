import type { ReactNode } from "react";
import { ArcArrow, Floor, Head, Limb, Torso } from "../poses/figure";

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


// ---------------------------------------------------------------------------
// ROW-CIRCUIT (2026-10-19): the rowing machine and the circuit's floor moves.
// Same primitives, same two-key-frame rule. A HOLD (side plank, forearm plank)
// has nothing to alternate, so its two frames are the hold and its one honest
// variation (side plank: top arm on the hip, then reaching up) or the same
// picture twice (forearm plank), which renders as a still.
// ---------------------------------------------------------------------------

/** The rail, seat track, foot stretcher and the water tank at the front. */
function Erg({ seat }: { seat: number }) {
  return (
    <g>
      <line x1={50} y1={252} x2={340} y2={252} stroke="currentColor" strokeWidth={6}
            strokeLinecap="round" opacity={0.35} />
      <rect x={seat - 22} y={238} width={44} height={10} rx={4} fill="currentColor" opacity={0.5} />
      <line x1={322} y1={208} x2={330} y2={250} stroke="currentColor" strokeWidth={8}
            strokeLinecap="round" opacity={0.5} />
      <circle cx={362} cy={226} r={26} fill="none" stroke="currentColor" strokeWidth={5} opacity={0.35} />
    </g>
  );
}

/** Chain from the handle to the tank. */
function Chain({ from }: { from: readonly [number, number] }) {
  return <line x1={from[0]} y1={from[1]} x2={350} y2={214} stroke="currentColor"
               strokeWidth={3} opacity={0.45} />;
}

/** Lying on the back, head left. */
function Mat() {
  return <Floor from={40} to={370} />;
}

export const ROW_CIRCUIT_MOVES: Record<string, Move> = {
  // ── the rower: catch, then finish ───────────────────────────────────────
  "rowing machine": {
    cycle: 2.6,
    frames: [
      // catch: shins vertical, body forward from the hips, arms long
      () => (
        <g>
          <Erg seat={196} />
          <Chain from={[304, 214]} />
          <Limb p={[[196, 236], [262, 178], [312, 236]]} />
          <Limb p={[[196, 236], [266, 182], [316, 238]]} far />
          <Torso neck={[234, 170]} hip={[196, 236]} />
          <Head at={[248, 152]} />
          <Limb p={[[234, 174], [304, 214]]} />
          <Limb p={[[236, 176], [306, 216]]} far />
        </g>
      ),
      // finish: legs long, slight lean back, handle drawn to the ribs
      () => (
        <g>
          <Erg seat={112} />
          <Chain from={[140, 204]} />
          <Limb p={[[112, 236], [214, 222], [312, 236]]} />
          <Limb p={[[112, 236], [216, 226], [316, 238]]} far />
          <Torso neck={[96, 168]} hip={[112, 236]} />
          <Head at={[86, 150]} />
          <Limb p={[[98, 174], [92, 210], [140, 204]]} />
          <Limb p={[[100, 176], [96, 212], [142, 206]]} far />
        </g>
      ),
    ],
  },

  // ── dead bug: opposite arm and leg lower, then switch ───────────────────
  "dead bug": {
    cycle: 2.4,
    frames: [
      () => (
        <g>
          <Mat />
          <Torso neck={[132, 256]} hip={[242, 260]} />
          <Head at={[108, 250]} />
          <Limb p={[[136, 256], [88, 240], [46, 230]]} />
          <Limb p={[[140, 256], [142, 176]]} far />
          <Limb p={[[242, 260], [242, 200], [296, 200]]} />
          <Limb p={[[242, 260], [300, 244], [356, 236]]} far />
        </g>
      ),
      () => (
        <g>
          <Mat />
          <Torso neck={[132, 256]} hip={[242, 260]} />
          <Head at={[108, 250]} />
          <Limb p={[[136, 256], [138, 176]]} />
          <Limb p={[[140, 256], [92, 240], [50, 230]]} far />
          <Limb p={[[242, 260], [300, 244], [356, 236]]} />
          <Limb p={[[242, 260], [246, 200], [300, 200]]} far />
        </g>
      ),
    ],
  },

  // ── plank shoulder taps: high plank, one hand to the opposite shoulder ──
  "plank shoulder taps": {
    cycle: 1.6,
    frames: [
      () => (
        <g>
          <Floor from={60} to={360} />
          <Limb p={[[150, 186], [150, 262]]} w={13} />
          <Limb p={[[158, 188], [196, 224], [170, 192]]} far />
          <Torso neck={[176, 178]} hip={[262, 206]} />
          <Head at={[160, 172]} />
          <Limb p={[[262, 206], [318, 244], [350, 262]]} />
          <Limb p={[[262, 206], [314, 246], [330, 262]]} far />
        </g>
      ),
      () => (
        <g>
          <Floor from={60} to={360} />
          <Limb p={[[158, 186], [158, 262]]} w={13} far />
          <Limb p={[[150, 188], [190, 222], [166, 194]]} />
          <Torso neck={[176, 178]} hip={[262, 206]} />
          <Head at={[160, 172]} />
          <Limb p={[[262, 206], [318, 244], [350, 262]]} />
          <Limb p={[[262, 206], [314, 246], [330, 262]]} far />
        </g>
      ),
    ],
  },

  // ── russian twist: leaning back, feet up, hands side to side ────────────
  "russian twist": {
    cycle: 1.8,
    frames: [
      () => (
        <g>
          <Floor from={60} to={360} />
          <Torso neck={[170, 180]} hip={[214, 254]} />
          <Head at={[158, 162]} />
          <Limb p={[[214, 254], [272, 200], [322, 226]]} />
          <Limb p={[[214, 254], [276, 204], [326, 230]]} far />
          <Limb p={[[176, 188], [214, 228], [252, 254]]} />
          <Limb p={[[178, 190], [216, 230], [254, 256]]} far />
          <ArcArrow c={[218, 236]} r={52} from={-30} to={40} />
        </g>
      ),
      () => (
        <g>
          <Floor from={60} to={360} />
          <Torso neck={[170, 180]} hip={[214, 254]} />
          <Head at={[158, 162]} />
          <Limb p={[[214, 254], [272, 200], [322, 226]]} />
          <Limb p={[[214, 254], [276, 204], [326, 230]]} far />
          <Limb p={[[176, 188], [196, 230], [176, 262]]} far />
          <Limb p={[[178, 190], [198, 232], [178, 264]]} far />
          <ArcArrow c={[218, 236]} r={52} from={40} to={-30} />
        </g>
      ),
    ],
  },

  // ── side plank: on the forearm, body one line; top arm hip → ceiling ────
  "side plank": {
    cycle: 3,
    frames: [
      () => (
        <g>
          <Floor from={60} to={360} />
          <Limb p={[[154, 186], [152, 262], [106, 262]]} w={13} />
          <Torso neck={[166, 180]} hip={[262, 224]} />
          <Head at={[150, 166]} />
          <Limb p={[[262, 224], [344, 262]]} />
          <Limb p={[[262, 222], [346, 256]]} far />
          <Limb p={[[170, 182], [216, 174], [256, 214]]} />
        </g>
      ),
      () => (
        <g>
          <Floor from={60} to={360} />
          <Limb p={[[154, 186], [152, 262], [106, 262]]} w={13} />
          <Torso neck={[166, 180]} hip={[262, 224]} />
          <Head at={[150, 166]} />
          <Limb p={[[262, 224], [344, 262]]} />
          <Limb p={[[262, 222], [346, 256]]} far />
          <Limb p={[[170, 180], [176, 96]]} />
        </g>
      ),
    ],
  },

  // ── bird dog: on hands and knees, opposite arm and leg long ─────────────
  "bird dog": {
    cycle: 2.6,
    frames: [
      () => (
        <g>
          <Floor from={40} to={380} />
          <Torso neck={[170, 190]} hip={[262, 198]} />
          <Head at={[146, 180]} />
          <Limb p={[[168, 192], [112, 184], [60, 180]]} />
          <Limb p={[[172, 194], [166, 262]]} far />
          <Limb p={[[262, 198], [262, 262], [318, 266]]} />
          <Limb p={[[262, 198], [318, 190], [372, 186]]} far />
        </g>
      ),
      () => (
        <g>
          <Floor from={40} to={380} />
          <Torso neck={[170, 190]} hip={[262, 198]} />
          <Head at={[146, 180]} />
          <Limb p={[[168, 192], [164, 262]]} />
          <Limb p={[[172, 194], [116, 186], [64, 182]]} far />
          <Limb p={[[262, 198], [318, 190], [372, 186]]} />
          <Limb p={[[262, 198], [266, 262], [322, 266]]} far />
        </g>
      ),
    ],
  },

  // ── flutter kicks: shoulders just off the mat, small alternating kicks ──
  "flutter kicks": {
    cycle: 1,
    frames: [
      () => (
        <g>
          <Mat />
          <Torso neck={[130, 246]} hip={[238, 260]} />
          <Head at={[108, 234]} />
          <Limb p={[[134, 250], [200, 262]]} />
          <Limb p={[[238, 260], [300, 236], [358, 220]]} />
          <Limb p={[[238, 260], [300, 252], [360, 248]]} far />
        </g>
      ),
      () => (
        <g>
          <Mat />
          <Torso neck={[130, 246]} hip={[238, 260]} />
          <Head at={[108, 234]} />
          <Limb p={[[134, 250], [200, 262]]} />
          <Limb p={[[238, 260], [300, 252], [360, 248]]} />
          <Limb p={[[238, 260], [300, 236], [358, 220]]} far />
        </g>
      ),
    ],
  },

  // ── glute bridge: hips down, then shoulders-hips-knees in one line ──────
  "glute bridge": {
    cycle: 2.4,
    frames: [
      () => (
        <g>
          <Mat />
          <Torso neck={[124, 256]} hip={[222, 260]} />
          <Head at={[100, 250]} />
          <Limb p={[[128, 258], [186, 264]]} />
          <Limb p={[[222, 260], [264, 204], [296, 264]]} />
          <Limb p={[[222, 260], [268, 208], [302, 264]]} far />
        </g>
      ),
      () => (
        <g>
          <Mat />
          <Torso neck={[124, 256]} hip={[214, 210]} />
          <Head at={[100, 250]} />
          <Limb p={[[128, 258], [186, 264]]} />
          <Limb p={[[214, 210], [264, 198], [296, 264]]} />
          <Limb p={[[214, 210], [268, 202], [302, 264]]} far />
        </g>
      ),
    ],
  },
};

// The forearm plank is a hold with no variation: the same picture twice is a
// still, which is what a hold should look like.
const forearmPlank = () => (
  <g>
    <Floor from={60} to={360} />
    <Limb p={[[160, 226], [160, 262], [110, 262]]} w={13} />
    <Limb p={[[166, 228], [168, 262], [118, 262]]} far />
    <Torso neck={[176, 222]} hip={[264, 236]} />
    <Head at={[156, 212]} />
    <Limb p={[[264, 236], [320, 252], [348, 262]]} />
    <Limb p={[[264, 236], [316, 254], [344, 264]]} far />
  </g>
);
ROW_CIRCUIT_MOVES["forearm plank"] = { cycle: 4, frames: [forearmPlank, forearmPlank] };

Object.assign(MOVES, ROW_CIRCUIT_MOVES);

/** The figure a movement name resolves to, or null when it has none yet. */
export function moveFor(name: string): Move | null {
  const k = name.toLowerCase();
  // ROW-CIRCUIT: exact names first. "Rowing machine" must win over the TRX
  // "row" match below, and "Dead bug" over the mountain climber it borrowed.
  if (MOVES[k]) return MOVES[k];
  if (k.includes("rowing machine") || k === "erg") return MOVES["rowing machine"];
  if (k.includes("shoulder tap")) return MOVES["plank shoulder taps"];
  if (k.includes("push-up")) return MOVES["push-up"];
  if (k.includes("row")) return MOVES["row"];
  if (k.includes("lunge") || k.includes("squat")) return MOVES["reverse lunge"];
  if (k.includes("mountain climber")) return MOVES["mountain climber"];
  if (k.includes("step-up") || k.includes("skater")) return MOVES["step-up"];
  if (k.includes("jog")) return MOVES["jog in place"];
  if (k.includes("march")) return MOVES["march in place"];
  return null;
}
