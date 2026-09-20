import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PITCH,
  DEFAULT_RATE,
  RATE_MAX,
  RATE_MIN,
  _resetVoiceCache,
  englishVoices,
  pickVoice,
  rankOf,
  readMidCues,
  setMidCues,
  setRate,
  setVoiceURI,
  storedRate,
  storedVoiceURI,
  voicesReady,
  watchVoices,
  type VoiceLike,
} from "../src/lib/voice";

// YOGA-5 — Ryan wants Ava, then Allison, then Samantha, then whatever the
// platform has, at a calmer rate. The part that actually bites is iOS
// resolving getVoices() asynchronously: the first call is usually EMPTY, and
// selecting from an empty list silently gives the default voice forever.

const v = (name: string, voiceURI = name, lang = "en-US"): VoiceLike =>
  ({ name, voiceURI, lang });

const AVA = v("Ava");
const AVA_ENH = v("Ava (Enhanced)", "com.apple.voice.enhanced.en-US.Ava");
const ALLISON = v("Allison");
const SAMANTHA = v("Samantha");
const DANIEL = v("Daniel", "Daniel", "en-GB");
const AMELIE = v("Amélie", "Amelie", "fr-CA");

beforeEach(() => {
  _resetVoiceCache();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("preferred voice order", () => {
  it("Ava beats Allison beats Samantha beats everything else", () => {
    expect(pickVoice([SAMANTHA, ALLISON, AVA, DANIEL])!.name).toBe("Ava");
    expect(pickVoice([SAMANTHA, ALLISON, DANIEL])!.name).toBe("Allison");
    expect(pickVoice([SAMANTHA, DANIEL])!.name).toBe("Samantha");
  });

  it("the enhanced build of a name wins over the plain one", () => {
    expect(pickVoice([AVA, AVA_ENH])!.voiceURI).toBe(AVA_ENH.voiceURI);
    expect(rankOf(AVA_ENH)).toBeGreaterThan(rankOf(AVA));
  });

  it("matches on the voiceURI too, not just the display name", () => {
    const uriOnly = v("Siri Voice 4", "com.apple.voice.enhanced.en-US.Ava");
    expect(pickVoice([DANIEL, uriOnly])!.voiceURI).toBe(uriOnly.voiceURI);
  });

  it("a preferred name in another language is not picked", () => {
    const frenchAva = v("Ava", "Ava-fr", "fr-FR");
    expect(pickVoice([frenchAva, DANIEL])).toBeNull();
  });
});

describe("falling back gracefully", () => {
  it("no preferred voice installed → null, meaning 'let the platform choose'", () => {
    expect(pickVoice([DANIEL, AMELIE])).toBeNull();
  });

  it("an empty list → null rather than a wrong guess", () => {
    expect(pickVoice([])).toBeNull();
    expect(pickVoice([], "Ava")).toBeNull();
  });

  it("a stored voice that is no longer installed re-picks instead of giving up", () => {
    // Ryan deleted the voice in iOS Settings. Keeping the platform default
    // forever, silently, is the failure mode this is here to prevent.
    const got = pickVoice([SAMANTHA, DANIEL], "Ava-that-is-gone");
    expect(got!.name).toBe("Samantha");
  });

  it("a stored voice that IS installed wins over the preference order", () => {
    expect(pickVoice([AVA, DANIEL], "Daniel")!.name).toBe("Daniel");
  });
});

describe("the picker list", () => {
  it("English only, preferred first, then alphabetical", () => {
    const list = englishVoices([DANIEL, SAMANTHA, AMELIE, AVA, ALLISON]);
    expect(list.map((x) => x.name)).toEqual(["Ava", "Allison", "Samantha", "Daniel"]);
    expect(list.find((x) => x.name === "Amélie")).toBeUndefined();
  });
});

describe("rate and pitch", () => {
  it("default to Ryan's numbers", () => {
    expect(DEFAULT_RATE).toBe(0.85);
    expect(DEFAULT_PITCH).toBe(0.95);
    expect(storedRate()).toBe(0.85);
  });

  it("a chosen rate persists and is clamped to a sane range", () => {
    expect(setRate(1.0)).toBe(1.0);
    expect(storedRate()).toBe(1.0);
    expect(setRate(99)).toBe(RATE_MAX);
    expect(setRate(0)).toBe(RATE_MIN);
    expect(storedRate()).toBe(RATE_MIN);
  });

  it("nonsense in storage falls back to the default instead of NaN", () => {
    window.localStorage.setItem("gd.voice.rate", "not a number");
    expect(storedRate()).toBe(DEFAULT_RATE);
  });

  it("a chosen voice persists", () => {
    setVoiceURI("com.apple.voice.enhanced.en-US.Ava");
    expect(storedVoiceURI()).toBe("com.apple.voice.enhanced.en-US.Ava");
  });

  it("storage that throws is survivable — the flow matters more than the setting", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("private browsing");
    });
    expect(() => storedRate()).not.toThrow();
    expect(storedRate()).toBe(DEFAULT_RATE);
    expect(readMidCues()).toBe(true);       // unreadable storage keeps the cues
    spy.mockRestore();
  });
});

describe("mid-hold cue toggle", () => {
  it("defaults on, and only an explicit off turns it off", () => {
    expect(readMidCues()).toBe(true);
    setMidCues(false);
    expect(readMidCues()).toBe(false);
    setMidCues(true);
    expect(readMidCues()).toBe(true);
  });
});

describe("voiceschanged — the empty first call", () => {
  /** A speechSynthesis whose list starts empty and fills later, like iOS. */
  function fakeSynth() {
    let voices: VoiceLike[] = [];
    const listeners: Array<() => void> = [];
    const s = {
      getVoices: () => voices,
      addEventListener: (_e: string, fn: () => void) => listeners.push(fn),
      populate(next: VoiceLike[]) {
        voices = next;
        for (const fn of listeners) fn();
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: s, configurable: true });
    return s;
  }

  it("waits for the event rather than accepting the empty list", async () => {
    const s = fakeSynth();
    const p = voicesReady(5000);
    s.populate([DANIEL, AVA]);
    const got = await p;
    expect(got.map((x) => x.name)).toContain("Ava");
    expect(pickVoice(got)!.name).toBe("Ava");
  });

  it("resolves empty after the timeout rather than hanging forever", async () => {
    fakeSynth();                       // never populates
    vi.useFakeTimers();
    const p = voicesReady(1000);
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toEqual([]);
    vi.useRealTimers();
  });

  it("a later change is picked up too — a voice installed mid-session", () => {
    const s = fakeSynth();
    const seen: number[] = [];
    watchVoices(() => seen.push(1));
    s.populate([AVA]);
    s.populate([AVA, ALLISON]);
    expect(seen).toHaveLength(2);
  });
});
