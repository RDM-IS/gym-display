let ctx: AudioContext | null = null;
let muted = false;
const listeners = new Set<() => void>();

/** "on" = unlocked and audible; "locked" = iOS still needs a user gesture. */
export type AudioStatus = "on" | "muted" | "locked" | "unsupported";

function notify(): void {
  for (const l of listeners) l();
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  ctx.onstatechange = notify;
  return ctx;
}

/** Unlock audio. MUST be called synchronously inside a user tap (iOS only
 * lets an AudioContext start from a gesture): resumes the context and plays a
 * one-sample silent buffer. Resolves true when the context is running. */
export async function unlockAudio(): Promise<boolean> {
  const c = ensureCtx();
  if (!c) return false;
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* ignore */
  }
  if (c.state !== "running") {
    try {
      await c.resume();
    } catch {
      return false;
    }
  }
  notify();
  return c.state === "running";
}

/** Back-compat alias used by the Start tap. */
export function initAudio(): void {
  void unlockAudio();
}

export function audioStatus(): AudioStatus {
  if (typeof window === "undefined") return "unsupported";
  const hasCtor =
    !!window.AudioContext ||
    !!(window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext;
  if (!hasCtor) return "unsupported";
  if (!ctx || ctx.state !== "running") return "locked";
  return muted ? "muted" : "on";
}

export function subscribeAudio(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setMuted(value: boolean): void {
  muted = value;
  notify();
}

export function toggleMuted(): boolean {
  muted = !muted;
  notify();
  return muted;
}

export function isMuted(): boolean {
  return muted;
}

interface ToneOpts {
  freq: number;
  duration_ms: number;
  start_offset_ms?: number;
  end_freq?: number;
  gain?: number;
}

/** Every tone the app asked for, newest last (observable in tests). */
export const toneLog: string[] = [];
if (typeof window !== "undefined") {
  (window as unknown as { __gymDisplayTones?: string[] }).__gymDisplayTones = toneLog;
}

function playTone(opts: ToneOpts): void {
  if (muted) return;
  const c = ensureCtx();
  if (!c || c.state !== "running") return;
  const start = c.currentTime + (opts.start_offset_ms ?? 0) / 1000;
  const end = start + opts.duration_ms / 1000;

  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(opts.freq, start);
  if (opts.end_freq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(opts.end_freq, end);
  }
  const peak = opts.gain ?? 0.5;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.01);
  gain.gain.setValueAtTime(peak, end - 0.02);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(end + 0.05);
}

export function beepCountdown(): void {
  playTone({ freq: 660, duration_ms: 100 });
}

export function beepEndOfWork(): void {
  playTone({ freq: 440, duration_ms: 600 });
}

export function beepEndOfRest(): void {
  playTone({ freq: 880, duration_ms: 200 });
}

export function beepEndOfRound(): void {
  playTone({ freq: 660, duration_ms: 200, start_offset_ms: 0 });
  playTone({ freq: 660, duration_ms: 200, start_offset_ms: 400 });
  playTone({ freq: 660, duration_ms: 200, start_offset_ms: 800 });
}

export function beepEndOfWorkout(): void {
  playTone({ freq: 880, end_freq: 440, duration_ms: 1500 });
}

// ── Recovery Flow (YOGA-1) ──────────────────────────────────────────────────

function logged(name: string, play: () => void): void {
  toneLog.push(name);
  play();
}

/** Soft chime: the 5 s "next" preview. */
export function chimeNext(): void {
  logged("next", () => {
    playTone({ freq: 988, duration_ms: 350, gain: 0.25 });
    playTone({ freq: 1319, duration_ms: 450, start_offset_ms: 180, gain: 0.2 });
  });
}

/** Distinct two-note swoop: switch sides. */
export function toneSwitchSides(): void {
  logged("switch", () => {
    playTone({ freq: 392, end_freq: 784, duration_ms: 350 });
    playTone({ freq: 784, end_freq: 392, duration_ms: 350, start_offset_ms: 420 });
  });
}

/** Round change. */
export function toneRound(): void {
  logged("round", () => beepEndOfRound());
}

export function toneFlowDone(): void {
  logged("done", () => beepEndOfWorkout());
}

// ── Voice cues: on-device speechSynthesis, no network ───────────────────────

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window &&
    typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function";
}

export const speechLog: string[] = [];
if (typeof window !== "undefined") {
  (window as unknown as { __gymDisplaySpeech?: string[] }).__gymDisplaySpeech = speechLog;
}

/** Say `text` unless muted. Never throws; without speech the tones still play. */
export function speak(text: string): void {
  if (muted || !text) return;
  speechLog.push(text);
  if (!speechSupported()) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    /* speech unavailable — tones still play */
  }
}

/** Unlock speech from a user gesture (iOS needs one utterance inside a tap). */
export function unlockSpeech(): void {
  if (!speechSupported()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

export function stopSpeech(): void {
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
