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

// ── Recovery Flow ───────────────────────────────────────────────────────────
//
// YOGA-4 (Ryan, 2026-09-20): the flow has NO tones at all — no lead-in chime,
// no switch-sides swoop, no round change, no hold-start tone, no completion
// sweep. Voice cues only. The tone helpers that used to live here are gone
// rather than left unused, so nothing can quietly start calling them again;
// tests/flow-audio.test.ts pins that. The beeps above belong to the workout
// timer, which is untouched.

// ── Voice cues: on-device speechSynthesis, no network ───────────────────────

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window &&
    typeof (window as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance === "function";
}

export const speechLog: string[] = [];
if (typeof window !== "undefined") {
  (window as unknown as { __gymDisplaySpeech?: string[] }).__gymDisplaySpeech = speechLog;
}

let pendingSpeech: ReturnType<typeof setTimeout> | null = null;

function clearPending(): void {
  if (pendingSpeech !== null) {
    clearTimeout(pendingSpeech);
    pendingSpeech = null;
  }
}

/** Say `text` unless muted — one utterance at a time: anything in flight (or
 * still waiting for its delay) is cancelled first, so a long lead-in never
 * talks over the move cue. `delayMs` lets a chime finish before the words.
 * Never throws; without speech the tones still play. */
export function speak(text: string, delayMs = 0): void {
  clearPending();
  if (muted || !text) return;
  if (delayMs > 0) {
    pendingSpeech = setTimeout(() => {
      pendingSpeech = null;
      speak(text);
    }, delayMs);
    return;
  }
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
  clearPending();
  if (!speechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
