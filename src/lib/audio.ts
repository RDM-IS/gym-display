let ctx: AudioContext | null = null;
let muted = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export function initAudio(): void {
  const c = ensureCtx();
  if (c && c.state === "suspended") {
    void c.resume();
  }
}

export function setMuted(value: boolean): void {
  muted = value;
}

export function toggleMuted(): boolean {
  muted = !muted;
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

function playTone(opts: ToneOpts): void {
  if (muted) return;
  const c = ensureCtx();
  if (!c) return;
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
