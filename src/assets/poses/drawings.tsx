import type { ReactNode } from "react";
import { ArcArrow, Floor, Head, Limb, Torso } from "./figure";

// ---------------------------------------------------------------------------
// The 14 Recovery Flow poses, savasana and seated meditation (YOGA-3), plus the
// Stretch Trainer and the legacy breathing screen.
// Original line figures drawn for gym-display — not traced from any source.
//
// `sided` drawings are the RIGHT-side version: profile poses face right with
// the right limbs near; front-view poses show the move to the screen's right
// (a mirror image, like following someone facing you). Side "L" mirrors them.
// ---------------------------------------------------------------------------

export interface Drawing {
  /** Mirror for side "L". */
  sided: boolean;
  art: () => ReactNode;
}

/** Cross-legged base shared by the seated poses (front view). */
function CrossedLegs() {
  return (
    <>
      <Limb p={[[190, 244], [126, 252], [214, 263]]} far />
      <Limb p={[[210, 244], [274, 252], [184, 262]]} />
      <Limb p={[[184, 244], [216, 244]]} w={12} />
    </>
  );
}

export const DRAWINGS: Record<string, Drawing> = {
  "child's pose": {
    sided: false,
    art: () => (
      <g transform="translate(-44 0)">
        <Floor from={84} to={404} />
        {/* shins on the mat, hips on the heels, chest folded over the thighs */}
        <Limb p={[[268, 258], [196, 262], [178, 266]]} far />
        <Limb p={[[190, 224], [262, 256], [196, 264], [176, 268]]} />
        <Torso neck={[272, 236]} hip={[190, 222]} bow={[226, 196]} />
        <Head at={[290, 252]} />
        <Limb p={[[270, 240], [316, 262], [362, 266]]} far />
        <Limb p={[[272, 238], [312, 258], [356, 264]]} />
      </g>
    ),
  },
  cobra: {
    sided: false,
    art: () => (
      <>
        <Floor />
        <Limb p={[[206, 262], [140, 265], [78, 266], [62, 262]]} far />
        <Limb p={[[206, 260], [140, 263], [76, 264], [58, 258]]} />
        <Torso neck={[272, 188]} hip={[206, 258]} bow={[252, 246]} />
        <Head at={[290, 168]} />
        <Limb p={[[268, 192], [262, 230], [270, 264]]} far />
        <Limb p={[[272, 192], [270, 230], [280, 264]]} />
      </>
    ),
  },
  "downward dog": {
    sided: false,
    art: () => (
      <>
        <Floor />
        <Limb p={[[196, 118], [162, 188], [132, 256], [150, 266]]} far />
        <Limb p={[[200, 116], [168, 186], [140, 254], [160, 266]]} />
        <Torso neck={[262, 184]} hip={[200, 114]} />
        <Head at={[268, 214]} r={16} />
        <Limb p={[[258, 186], [282, 222], [304, 262]]} far />
        <Limb p={[[262, 186], [288, 224], [312, 262], [328, 266]]} />
      </>
    ),
  },
  "standing forward bend": {
    sided: false,
    art: () => (
      <>
        <Floor />
        <Limb p={[[192, 150], [194, 206], [190, 262], [210, 268]]} far />
        <Limb p={[[196, 148], [202, 206], [198, 262], [220, 268]]} />
        <Torso neck={[236, 220]} hip={[196, 146]} bow={[256, 150]} />
        <Head at={[232, 244]} />
        <Limb p={[[232, 222], [242, 246], [238, 266]]} far />
        <Limb p={[[236, 222], [250, 244], [248, 266]]} />
      </>
    ),
  },
  "high lunge": {
    sided: true,
    art: () => (
      <>
        <Floor />
        {/* back (left) leg straight, heel lifted */}
        <Limb p={[[206, 192], [156, 222], [106, 252], [124, 268]]} far />
        {/* front (right) knee over the ankle */}
        <Limb p={[[212, 190], [270, 204], [272, 262], [294, 268]]} />
        <Torso neck={[214, 110]} hip={[210, 190]} />
        <Head at={[216, 88]} />
        <Limb p={[[210, 114], [206, 68], [202, 24]]} far />
        <Limb p={[[216, 114], [222, 68], [226, 24]]} />
      </>
    ),
  },
  "crescent lunge": {
    sided: true,
    art: () => (
      <>
        <Floor />
        {/* deeper: hips lower, back leg long, a gentle backbend */}
        <Limb p={[[196, 212], [144, 236], [88, 254], [104, 268]]} far />
        <Limb p={[[202, 210], [262, 212], [270, 264], [292, 268]]} />
        <Torso neck={[190, 132]} hip={[200, 210]} bow={[218, 170]} />
        <Head at={[182, 110]} />
        <Limb p={[[186, 136], [172, 90], [156, 48]]} far />
        <Limb p={[[192, 136], [180, 90], [168, 46]]} />
      </>
    ),
  },
  "extended puppy": {
    sided: false,
    art: () => (
      <>
        <Floor />
        {/* hips stacked over the knees, chest melting toward the mat */}
        <Limb p={[[176, 204], [174, 262], [120, 266], [104, 262]]} far />
        <Limb p={[[180, 202], [180, 262], [126, 266], [110, 264]]} />
        <Torso neck={[262, 246]} hip={[180, 200]} bow={[228, 240]} />
        <Head at={[280, 254]} r={16} />
        <Limb p={[[260, 248], [306, 262], [352, 266]]} far />
        <Limb p={[[262, 246], [310, 258], [358, 264]]} />
      </>
    ),
  },
  bridge: {
    sided: false,
    art: () => (
      <>
        <Floor />
        <Limb p={[[166, 212], [218, 202], [228, 258], [248, 266]]} far />
        <Limb p={[[170, 208], [228, 198], [238, 256], [258, 266]]} />
        <Torso neck={[94, 256]} hip={[170, 206]} bow={[126, 212]} />
        <Head at={[72, 252]} />
        <Limb p={[[96, 260], [138, 266], [180, 268]]} />
      </>
    ),
  },
  "supine twist": {
    sided: true,
    art: () => (
      <>
        {/* seen from above: head left, arms out wide, knees dropped to the
            right (the bottom of the screen for a figure lying face-up) */}
        <rect x={40} y={24} width={320} height={252} rx={14} fill="none"
              stroke="currentColor" strokeWidth={4} opacity={0.22} />
        <Limb p={[[98, 146], [98, 98], [98, 50]]} />
        <Limb p={[[98, 154], [98, 202], [98, 250]]} />
        <Limb p={[[98, 124], [98, 176]]} w={14} />
        <Torso neck={[98, 150]} hip={[188, 150]} />
        <Head at={[70, 150]} />
        <Limb p={[[188, 156], [226, 234], [178, 262]]} far />
        <Limb p={[[190, 148], [244, 214], [196, 250]]} />
        <ArcArrow c={[190, 150]} r={70} from={-10} to={40} />
      </>
    ),
  },
  "wind release": {
    sided: true,
    art: () => (
      <>
        <Floor />
        {/* left leg long on the mat */}
        <Limb p={[[180, 260], [240, 264], [298, 264], [304, 246]]} far />
        <Torso neck={[96, 256]} hip={[180, 258]} />
        <Head at={[72, 252]} />
        {/* right knee hugged to the chest */}
        <Limb p={[[180, 256], [140, 206], [194, 192], [210, 198]]} />
        <Limb p={[[96, 252], [110, 214], [150, 198]]} />
      </>
    ),
  },
  "seated side bend": {
    sided: true,
    art: () => (
      <>
        <Floor from={90} to={310} />
        <CrossedLegs />
        {/* torso tilted ~28°, shoulders square to it, the top arm reaching over */}
        <Torso neck={[238, 168]} hip={[200, 240]} />
        <Limb p={[[219, 158], [257, 178]]} w={12} />
        <Head at={[249, 148]} />
        <Limb p={[[219, 158], [236, 104], [284, 90]]} />
        <Limb p={[[257, 178], [272, 212], [280, 246]]} />
      </>
    ),
  },
  "seated twist": {
    sided: true,
    art: () => (
      <>
        <Floor from={90} to={310} />
        <CrossedLegs />
        <Torso neck={[200, 154]} hip={[200, 240]} />
        {/* shoulders turned: one foreshortened, the far hand on the floor behind */}
        <Limb p={[[180, 160], [218, 158]]} w={12} />
        <Limb p={[[218, 160], [250, 196], [246, 244]]} far />
        <Head at={[204, 130]} />
        {/* the left hand crosses to the right knee */}
        <Limb p={[[180, 162], [214, 206], [264, 246]]} />
        <ArcArrow c={[204, 130]} r={40} from={200} to={330} />
      </>
    ),
  },
  "seated mountain": {
    sided: false,
    art: () => (
      <>
        <Floor from={90} to={310} />
        <CrossedLegs />
        <Torso neck={[200, 156]} hip={[200, 240]} />
        <Limb p={[[172, 160], [228, 160]]} w={12} />
        <Head at={[200, 132]} />
        <Limb p={[[172, 160], [166, 110], [194, 64]]} />
        <Limb p={[[228, 160], [234, 110], [206, 64]]} />
      </>
    ),
  },
  "easy pose": {
    sided: false,
    art: () => (
      <>
        <Floor from={90} to={310} />
        <CrossedLegs />
        <Torso neck={[200, 156]} hip={[200, 240]} />
        <Limb p={[[172, 160], [228, 160]]} w={12} />
        <Head at={[200, 132]} />
        <Limb p={[[172, 160], [158, 204], [138, 248]]} />
        <Limb p={[[228, 160], [242, 204], [262, 248]]} />
      </>
    ),
  },
  // YOGA-3: the closing rest — flat on the back, arms by the sides.
  savasana: {
    sided: false,
    art: () => (
      <>
        <Floor />
        <Limb p={[[180, 258], [240, 262], [300, 264], [308, 246]]} far />
        <Limb p={[[180, 262], [240, 266], [300, 268], [310, 250]]} />
        <Torso neck={[96, 256]} hip={[180, 260]} />
        <Head at={[72, 252]} />
        <Limb p={[[98, 262], [140, 268], [176, 270]]} />
      </>
    ),
  },
  // ── Icons for the two non-pose screens ──
  "stretch trainer": {
    sided: false,
    art: () => (
      <g fill="none" stroke="currentColor" strokeWidth={10} strokeLinecap="round"
         strokeLinejoin="round">
        <line x1={70} y1={262} x2={330} y2={262} />
        {/* frame: base to a tall upright with the handle bar on top */}
        <path d="M110 262 L130 150 L250 150 L270 262" />
        <path d="M250 150 L262 72" />
        <path d="M236 72 L288 72" strokeWidth={12} />
        {/* seat and knee pad */}
        <rect x={96} y={126} width={78} height={22} rx={11} fill="currentColor" stroke="none" />
        <rect x={212} y={188} width={56} height={24} rx={12} fill="currentColor" stroke="none"
              opacity={0.55} />
      </g>
    ),
  },
  "easy pose breathing": {
    sided: false,
    art: () => (
      <>
        <circle cx={200} cy={150} r={116} fill="none" stroke="currentColor" strokeWidth={5}
                opacity={0.18} />
        <circle cx={200} cy={150} r={86} fill="none" stroke="currentColor" strokeWidth={6}
                opacity={0.35} />
        <circle cx={200} cy={150} r={56} fill="none" stroke="currentColor" strokeWidth={8}
                opacity={0.6} />
        <circle cx={200} cy={150} r={24} fill="currentColor" />
      </>
    ),
  },
};

// YOGA-3: the opening minute sits cross-legged, like easy pose.
DRAWINGS["seated meditation"] = DRAWINGS["easy pose"];

// ---------------------------------------------------------------------------
// EXTRA-FIGURES (2026-09-28) — the rest of the Extras get drawings.
//
// Original line figures drawn for gym-display in the same system as the 14
// above: the same primitives, the same 400x300 canvas, the same floor, the same
// stroke weights, `currentColor` throughout so light and dark follow the theme.
// NOT traced or copied from any source.
//
// Same conventions: a profile figure faces RIGHT with its right limbs near, a
// `sided` drawing is the "R" version and side "L" mirrors it, and limbs on the
// far side of the body are drawn faint.
//
// YOGA-6 poses (5) are flow poses. Core (5) and Mobility (6) are CIRCUIT
// exercises, keyed by exercise name into this same registry so there is one
// place figures live — a second registry would drift from this one.
//
// Four of these are MOVEMENTS rather than positions (cat-cow, dead bug, bird
// dog, 90/90). Cat-cow gets TWO FRAMES because its two ends are the whole
// point; the other three get the key position plus an ArcArrow, because their
// start and end differ only by which limb is out, and two near-identical frames
// read as a mistake rather than a movement.
// ---------------------------------------------------------------------------

/** Hands-and-knees base, bowed up (cat) or down (cow) by `bow`. */
function Quadruped({ bow }: { bow: readonly [number, number] }) {
  return (
    <>
      <Floor />
      {/* far arm + far shin */}
      <Limb p={[[286, 202], [288, 234], [290, 262]]} far />
      <Limb p={[[176, 208], [166, 240], [160, 262]]} far />
      <Limb p={[[170, 210], [124, 250], [104, 264]]} far />
      {/* near foreleg planted, near thigh + shin */}
      <Limb p={[[292, 200], [296, 232], [298, 262]]} />
      <Limb p={[[180, 206], [172, 238], [166, 262]]} />
      <Limb p={[[176, 208], [130, 252], [108, 266]]} />
      <Torso neck={[288, 198]} hip={[178, 206]} bow={bow} />
    </>
  );
}

// ── YOGA-6 ────────────────────────────────────────────────────────────────
DRAWINGS["chair"] = {
  sided: false,
  art: () => (
    <>
      <Floor />
      {/* far leg */}
      <Limb p={[[128, 178], [166, 208], [140, 266]]} far />
      {/* knees FORWARD of the ankles, hips BACK behind the heels */}
      <Limb p={[[132, 176], [176, 206], [150, 266]]} />
      <Torso neck={[176, 104]} hip={[132, 176]} />
      <Head at={[188, 86]} />
      {/* arms continue the line of the back, overhead and forward */}
      <Limb p={[[170, 110], [208, 76], [240, 48]]} far />
      <Limb p={[[174, 108], [214, 72], [248, 44]]} />
    </>
  ),
};

DRAWINGS["plank"] = {
  sided: false,
  art: () => (
    <>
      <Floor />
      {/* one straight line heels -> hips -> shoulders */}
      <Limb p={[[190, 228], [140, 246], [92, 264], [80, 266]]} far />
      <Limb p={[[196, 225], [144, 244], [96, 262], [84, 266]]} />
      <Torso neck={[290, 190]} hip={[196, 225]} />
      <Head at={[306, 184]} />
      {/* hands directly under the shoulders */}
      <Limb p={[[286, 194], [288, 230], [290, 264]]} far />
      <Limb p={[[290, 192], [294, 228], [296, 264]]} />
    </>
  ),
};

DRAWINGS["warrior ii"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* back leg straight, front leg bent to the screen's right */}
      <Limb p={[[186, 168], [146, 216], [110, 264]]} far />
      <Limb p={[[216, 168], [284, 214], [300, 264]]} />
      <Limb p={[[186, 168], [216, 168]]} w={12} />
      <Torso neck={[200, 100]} hip={[200, 166]} />
      <Head at={[200, 76]} />
      {/* arms long and level, front arm leading */}
      <Limb p={[[194, 106], [134, 108], [72, 110]]} far />
      <Limb p={[[206, 106], [266, 108], [330, 110]]} />
    </>
  ),
};

DRAWINGS["warrior iii"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* back leg reaching straight behind, level with the torso */}
      <Limb p={[[196, 152], [142, 158], [88, 164]]} far />
      {/* standing leg, vertical under the hip */}
      <Limb p={[[196, 150], [197, 208], [198, 264]]} />
      <Torso neck={[284, 142]} hip={[196, 150]} />
      <Head at={[308, 140]} />
      {/* arms reaching forward past the ears */}
      <Limb p={[[278, 146], [322, 144], [366, 142]]} far />
      <Limb p={[[280, 144], [324, 140], [368, 136]]} />
    </>
  ),
};

DRAWINGS["low lunge twist"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* back knee DOWN on the mat */}
      <Limb p={[[184, 224], [136, 262], [92, 266]]} far />
      <Limb p={[[186, 222], [140, 262], [96, 266]]} />
      {/* front leg bent, foot flat */}
      <Limb p={[[192, 222], [268, 236], [274, 264]]} />
      <Torso neck={[196, 140]} hip={[190, 220]} />
      <Head at={[200, 118]} />
      {/* lower hand inside the front foot, upper arm stacked above it */}
      <Limb p={[[198, 148], [222, 196], [248, 256]]} far />
      <Limb p={[[194, 146], [176, 104], [168, 62]]} />
      {/* the turn a single figure cannot show */}
      <ArcArrow c={[196, 160]} r={54} from={-128} to={-34} />
    </>
  ),
};

// ── Core ──────────────────────────────────────────────────────────────────
/** Supine 90/90 base. `extend` swaps the NEAR arm and the FAR leg out to long. */
function DeadBugFrame({ extend }: { extend: boolean }) {
  return (
    <>
      <Floor from={60} to={368} />
      <Torso neck={[266, 250]} hip={[180, 256]} />
      <Head at={[288, 246]} />
      {/* The left and right limbs are SPLAYED apart into a narrow V. In a true
          side view they overlap almost exactly, so the start frame showed what
          looked like one arm and one leg and read as a bracket rather than a body
          with four limbs at 90/90. Nothing is parallel either: drawn square --
          arm vertical, thigh vertical, shin level -- the limbs close into a
          rectangle, which is what two earlier drafts did. */}
      <Limb p={[[262, 252], [256, 206], [250, 168]]} far />
      {extend
        ? <Limb p={[[176, 258], [126, 252], [74, 248]]} far />
        : <Limb p={[[176, 258], [160, 202], [204, 194]]} far />}
      {extend
        ? <Limb p={[[266, 250], [310, 256], [352, 260]]} />
        : <Limb p={[[268, 250], [282, 208], [294, 170]]} />}
      <Limb p={[[182, 256], [178, 196], [228, 210]]} />
    </>
  );
}

DRAWINGS["dead bug"] = {
  // The side is the EXTENDING ARM: the base is the right arm reaching back with
  // the LEFT leg long, and "L" mirrors to the left arm with the right leg.
  sided: true,
  art: () => (
    <>
      {/* TWO FRAMES, like cat-cow -- the opposite-limb pairing IS the exercise and
          no single position can show a pairing. STACKED rather than side by side:
          a supine figure is wide and shallow, so half-width columns forced it down
          to a third of the canvas and it stopped reading at all. Full size, top is
          the 90/90 start, bottom is the move. */}
      <g transform="translate(0 -148)">
        <DeadBugFrame extend={false} />
      </g>
      <DeadBugFrame extend />
    </>
  ),
};

DRAWINGS["bird dog"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* supporting far hand and far knee */}
      <Limb p={[[290, 200], [290, 232], [290, 264]]} far />
      <Limb p={[[178, 206], [166, 240], [162, 262]]} far />
      <Limb p={[[174, 208], [130, 252], [110, 266]]} far />
      {/* near arm reaching forward, near leg reaching back, both level */}
      <Limb p={[[298, 196], [334, 188], [372, 182]]} />
      <Limb p={[[180, 202], [128, 194], [76, 188]]} />
      <Torso neck={[292, 196]} hip={[180, 204]} />
      <Head at={[316, 190]} />
    </>
  ),
};

DRAWINGS["side plank"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* forearm down, shoulder stacked above the elbow */}
      <Limb p={[[124, 200], [118, 232], [86, 264], [122, 264]]} />
      {/* one line shoulder -> hip -> stacked feet */}
      <Limb p={[[212, 232], [262, 248], [310, 264]]} far />
      <Limb p={[[216, 230], [266, 246], [314, 262]]} />
      <Torso neck={[126, 200]} hip={[216, 230]} />
      <Head at={[106, 193]} />
      {/* top arm straight up */}
      <Limb p={[[128, 198], [140, 148], [150, 98]]} />
    </>
  ),
};

// Core's "Glute bridge" is the Recovery Flow's "Bridge" — the same pose under
// two names. Reused rather than redrawn: a second drawing of one pose is a
// second thing to keep in step, and mine read worse than the original.
DRAWINGS["glute bridge"] = DRAWINGS.bridge;

DRAWINGS["mcgill curl-up"] = {
  // The side is WHICH KNEE IS BENT.
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* the far leg stays LONG on the floor */}
      <Limb p={[[182, 262], [132, 265], [82, 266]]} far />
      {/* the near knee is bent with the foot FLAT on the mat */}
      <Limb p={[[190, 256], [142, 212], [108, 258], [92, 264]]} />
      {/* head and shoulders lift only SLIGHTLY — a small gap off the mat, not a
          sit-up: the hips and the low back never leave the floor */}
      <Torso neck={[250, 240]} hip={[186, 258]} bow={[216, 254]} />
      <Head at={[270, 232]} />
      {/* both hands flat UNDER the low back */}
      <Limb p={[[246, 244], [220, 260], [194, 264]]} far />
      <Limb p={[[250, 242], [224, 262], [198, 266]]} />
    </>
  ),
};

// ── Mobility ──────────────────────────────────────────────────────────────
DRAWINGS["cat-cow"] = {
  sided: false,
  art: () => (
    <>
      {/* TWO FRAMES: the rounded end and the dipped end, which are the move */}
      <g transform="translate(-6 24) scale(0.52)">
        <Quadruped bow={[232, 150]} />
        <Head at={[300, 224]} r={17} />
      </g>
      <g transform="translate(196 24) scale(0.52)">
        <Quadruped bow={[232, 254]} />
        <Head at={[300, 172]} r={17} />
      </g>
      <line x1={198} y1={92} x2={198} y2={230} stroke="currentColor" strokeWidth={3}
            opacity={0.18} />
    </>
  ),
};

DRAWINGS["90/90 hip switch"] = {
  sided: false,
  art: () => (
    // DRAWN FROM ABOVE, and it is the only figure here that is. Every other
    // drawing is a profile, but 90/90 is defined by where the legs are in the
    // TRANSVERSE plane — one thigh forward with the shin across the body, the
    // other thigh out to the side with the shin back — and a side view collapses
    // exactly the angles that make it the pose. Two side-view drafts read as a
    // standing figure and as someone sitting on a stick. Clarity over a
    // consistent viewpoint; there is no floor line because the floor is the page.
    <>
      <Head at={[200, 112]} />
      <Limb p={[[172, 142], [228, 142]]} w={12} />
      <Torso neck={[200, 142]} hip={[200, 178]} />
      <Limb p={[[176, 178], [224, 178]]} w={12} />
      {/* arms resting on the floor either side */}
      {/* NOTHING here is drawn faint, and that is the other consequence of the
          viewpoint: `far` means "on the side of the body away from you", which
          from ABOVE occludes nothing. Drawn faint, the back leg read as a ghost
          bracket rather than a leg. */}
      <Limb p={[[174, 146], [158, 154], [144, 162]]} />
      <Limb p={[[226, 146], [250, 158], [270, 172]]} />
      {/* BACK leg: thigh out to the SIDE, shin pointing BACK, knee on the floor.
          Set wide and low so the shin finishes clear of the arm above it. */}
      <Limb p={[[184, 182], [106, 208], [98, 158]]} />
      {/* FRONT leg: thigh FORWARD, shin running ACROSS the body, knee on the floor */}
      <Limb p={[[216, 180], [224, 238], [158, 250]]} />
      {/* the switch is the KNEES swinging across, not the torso turning */}
      <ArcArrow c={[200, 196]} r={92} from={28} to={152} />
    </>
  ),
};

DRAWINGS["half-kneeling hip flexor stretch"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* back knee down, that hip pressing forward */}
      <Limb p={[[182, 218], [136, 262], [92, 266]]} far />
      <Limb p={[[186, 216], [140, 262], [96, 266]]} />
      {/* front foot flat, shin vertical */}
      <Limb p={[[192, 216], [266, 228], [272, 264]]} />
      {/* torso TALL — the stretch is the hip, not a forward lean */}
      <Torso neck={[192, 132]} hip={[188, 214]} />
      <Head at={[196, 110]} />
      <Limb p={[[188, 138], [200, 184], [210, 210]]} far />
      <Limb p={[[194, 138], [208, 184], [220, 212]]} />
    </>
  ),
};

DRAWINGS["thread the needle"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* on all fours: hips stay UP, knees under them, shins back to the feet */}
      <Limb p={[[174, 208], [164, 250], [120, 266]]} far />
      <Limb p={[[180, 206], [170, 250], [126, 266]]} />
      {/* the torso slopes DOWN to a shoulder that is on the mat -- that drop is
          the pose, and a level torso made it read as a plain quadruped */}
      <Torso neck={[266, 248]} hip={[180, 206]} />
      {/* the SIDE of the head rests on the mat beside that shoulder */}
      <Head at={[292, 258]} r={16} />
      {/* the other hand stays planted */}
      {/* clear of the head, which sat on top of it when the hand was closer in */}
      <Limb p={[[272, 240], [312, 244], [342, 262]]} far />
      {/* the threading arm slides UNDER the body and stops beneath the chest --
          reaching it past the knees closed the torso, arm and thigh into one
          triangle and the figure stopped reading as a person on all fours */}
      <Limb p={[[266, 250], [238, 262], [206, 266]]} />
    </>
  ),
};

DRAWINGS["ankle rocks"] = {
  sided: true,
  art: () => (
    <>
      <Floor />
      {/* half-kneeling, back knee down */}
      <Limb p={[[182, 222], [136, 262], [92, 266]]} far />
      <Limb p={[[186, 220], [140, 262], [96, 266]]} />
      {/* the front knee travels FORWARD OVER the toes — heel stays down */}
      <Limb p={[[192, 220], [296, 214], [278, 262], [296, 266]]} />
      <Torso neck={[192, 138]} hip={[188, 218]} />
      <Head at={[196, 116]} />
      {/* hands on the front knee */}
      <Limb p={[[190, 146], [232, 180], [284, 208]]} far />
      <Limb p={[[194, 144], [236, 178], [290, 206]]} />
      {/* the rock itself */}
      <ArcArrow c={[250, 226]} r={62} from={-58} to={-4} />
    </>
  ),
};

