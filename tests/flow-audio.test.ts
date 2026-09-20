import { describe, expect, it } from "vitest";
import * as audio from "../src/lib/audio";
import audioSrc from "../src/lib/audio.ts?raw";
import flowSrc from "../src/lib/flow.ts?raw";
import screenSrc from "../src/screens/FlowScreen.tsx?raw";
import badgeSrc from "../src/components/SoundBadge.tsx?raw";

// YOGA-4 (Ryan, 2026-09-20): the Recovery Flow has NO tones. No lead-in chime,
// no switch-sides swoop, no round change, no hold-start tone, no completion
// sweep. Voice cues only.
//
// A behavioural test can only show that nothing sounded on the paths it
// happened to walk. These two check the code itself, which is the claim: the
// helpers are gone, and the flow player imports nothing that makes noise. The
// workout timer's beeps are a different screen and stay.

describe("the flow makes no sound but speech", () => {
  const GONE = ["chimeNext", "toneSwitchSides", "toneRound", "toneHoldStart",
                "toneMove", "toneFlowDone"];

  it("the flow tone helpers no longer exist", () => {
    for (const name of GONE) {
      expect(audio, name).not.toHaveProperty(name);
    }
  });

  it("the flow player imports nothing that plays a tone", () => {
    const src = screenSrc;
    for (const name of GONE) expect(src, name).not.toContain(name);
    expect(src).not.toMatch(/\b(beep|chime|playTone)\w*/i);
    // It still speaks.
    expect(src).toContain("speak(");
  });

  it("the flow engine has no chime lead any more", () => {
    const src = flowSrc;
    expect(src).not.toContain("CHIME_LEAD_MS");
    expect(src).not.toMatch(/\b(tone|chime|beep)\w*\s*[(:]/i);
  });

  it("the workout timer keeps its beeps — this is about the flow only", () => {
    for (const name of ["beepCountdown", "beepEndOfWork", "beepEndOfRest",
                        "beepEndOfRound", "beepEndOfWorkout"]) {
      expect(audio, name).toHaveProperty(name);
    }
  });

  it("nothing anywhere still reaches for a flow tone", () => {
    const files: [string, string][] = [
      ["audio.ts", audioSrc], ["FlowScreen.tsx", screenSrc],
      ["flow.ts", flowSrc], ["SoundBadge.tsx", badgeSrc],
    ];
    for (const [file, src] of files) {
      for (const name of GONE) expect(src, `${file} / ${name}`).not.toContain(name);
    }
  });
});
