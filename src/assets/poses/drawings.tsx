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
