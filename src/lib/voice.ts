// YOGA-5 (Ryan, 2026-09-20) — a calmer voice than the system default.
//
// Two problems, and the second is the one that bites:
//
//   1. The default iOS voice is brisk. Ryan wants Ava, then Allison, then
//      Samantha, then whatever the platform has — and a slower rate and
//      slightly lower pitch, both tunable.
//
//   2. `speechSynthesis.getVoices()` is asynchronous on iOS and usually
//      returns EMPTY on the first call. Selecting from that empty list gives
//      the default voice and never retries, which is exactly the silent
//      fallback Ryan said not to accept. So: resolve once `voiceschanged`
//      fires, and re-resolve whenever the list changes.
//
// Everything reads/writes localStorage through try/catch — Safari in a private
// window throws on access, and a stored preference is not worth a broken flow.

export const DEFAULT_RATE = 0.85;
export const DEFAULT_PITCH = 0.95;
export const RATE_MIN = 0.6;
export const RATE_MAX = 1.2;

/** Ryan's order. Matched case-insensitively against a voice's name and its
 * voiceURI, so "Ava (Enhanced)", "com.apple.voice.enhanced.en-US.Ava" and a
 * plain "Ava" all hit. Enhanced wins within a name — see scoreVoice. */
export const PREFERRED = ["ava", "allison", "samantha"] as const;

const RATE_KEY = "gd.voice.rate";
const VOICE_KEY = "gd.voice.uri";

export interface VoiceLike {
  name: string;
  voiceURI: string;
  lang: string;
  default?: boolean;
  localService?: boolean;
}

export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;   // private window, blocked storage — not worth failing over
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore — the session still works, it just won't be remembered */
  }
}

export function isEnglish(v: VoiceLike): boolean {
  return /^en\b/i.test(v.lang ?? "");
}

/** English voices only, preferred ones first, each group A-Z. What the picker
 * lists and the order it lists them in. */
export function englishVoices(voices: VoiceLike[]): VoiceLike[] {
  return voices
    .filter(isEnglish)
    .slice()
    .sort((a, b) => {
      const d = rankOf(b) - rankOf(a);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
}

function matches(v: VoiceLike, needle: string): boolean {
  const hay = `${v.name} ${v.voiceURI}`.toLowerCase();
  return hay.includes(needle);
}

/** Higher is better. Position in PREFERRED dominates; "enhanced"/"premium"
 * breaks the tie inside one name, so Ava (Enhanced) beats plain Ava. */
export function rankOf(v: VoiceLike): number {
  const i = PREFERRED.findIndex((p) => matches(v, p));
  if (i < 0) return 0;
  const base = (PREFERRED.length - i) * 10;
  const enhanced = /enhanced|premium/i.test(`${v.name} ${v.voiceURI}`);
  return base + (enhanced ? 5 : 0);
}

/** The voice to use: the stored choice if it is still installed, else the
 * best preferred English voice, else null — which means "let the platform
 * decide", not "we failed". */
export function pickVoice(voices: VoiceLike[], storedURI?: string | null): VoiceLike | null {
  if (!voices.length) return null;
  if (storedURI) {
    const exact = voices.find((v) => v.voiceURI === storedURI);
    if (exact) return exact;
    // Stored voice uninstalled or renamed — fall through and pick again
    // rather than silently keeping the platform default forever.
  }
  const ranked = voices.filter(isEnglish).filter((v) => rankOf(v) > 0);
  if (!ranked.length) return null;
  return ranked.reduce((best, v) => (rankOf(v) > rankOf(best) ? v : best));
}

// ── Resolution, including the empty-first-call race ─────────────────────────

let cached: VoiceLike[] = [];
let listening = false;
const waiters: Array<(v: VoiceLike[]) => void> = [];

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis;
}

function refresh(): VoiceLike[] {
  const s = synth();
  if (!s) return [];
  try {
    cached = s.getVoices() ?? [];
  } catch {
    cached = [];
  }
  return cached;
}

/** Start listening for `voiceschanged` once. iOS fires it when the list
 * finally populates, and again if the user installs or removes a voice. */
export function watchVoices(onChange?: () => void): void {
  const s = synth();
  if (!s || listening) return;
  listening = true;
  refresh();
  const handler = () => {
    refresh();
    for (const w of waiters.splice(0)) w(cached);
    onChange?.();
  };
  try {
    s.addEventListener("voiceschanged", handler);
  } catch {
    (s as unknown as { onvoiceschanged: () => void }).onvoiceschanged = handler;
  }
}

export function voicesNow(): VoiceLike[] {
  return cached.length ? cached : refresh();
}

/** Resolve the voice list, waiting for `voiceschanged` when the first call
 * comes back empty. Resolves with [] after `timeoutMs` so a platform that
 * never fires the event cannot hang the caller. */
export function voicesReady(timeoutMs = 2000): Promise<VoiceLike[]> {
  const now = voicesNow();
  if (now.length) return Promise.resolve(now);
  watchVoices();
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: VoiceLike[]) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    waiters.push(finish);
    setTimeout(() => finish(voicesNow()), timeoutMs);
  });
}

// ── The settings the player reads ───────────────────────────────────────────

export interface VoiceSettings {
  voiceURI: string | null;
  rate: number;
  pitch: number;
}

export function storedRate(): number {
  const raw = readStored(RATE_KEY);
  const n = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, n));
}

export function storedVoiceURI(): string | null {
  return readStored(VOICE_KEY);
}

export function setRate(rate: number): number {
  const clamped = Math.min(RATE_MAX, Math.max(RATE_MIN, rate));
  writeStored(RATE_KEY, String(clamped));
  return clamped;
}

export function setVoiceURI(uri: string | null): void {
  writeStored(VOICE_KEY, uri ?? "");
}

/** What `speak()` should apply right now. */
export function currentSettings(): VoiceSettings {
  const chosen = pickVoice(voicesNow(), storedVoiceURI());
  return { voiceURI: chosen?.voiceURI ?? null, rate: storedRate(), pitch: DEFAULT_PITCH };
}

/** Reset — tests only. */
export function _resetVoiceCache(): void {
  cached = [];
  listening = false;
  waiters.length = 0;
}

// ── Mid-hold cues: on by default, one tap to silence ───────────────────────

const MID_KEY = "gd.voice.midcues";

/** Default ON. Only an explicit "0" turns them off, so unreadable storage
 * leaves Ryan with the cues rather than silently removing them. */
export function readMidCues(): boolean {
  return readStored(MID_KEY) !== "0";
}

export function setMidCues(on: boolean): boolean {
  writeStored(MID_KEY, on ? "1" : "0");
  return on;
}
