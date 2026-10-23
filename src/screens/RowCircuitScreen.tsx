import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Stepper from "../components/Stepper";
import MoveFigure from "../assets/circuit/MoveFigure";
import { fetchRowCircuit } from "../lib/api";
import { audioStatus, isMuted, speak, stopSpeech, subscribeAudio, toggleMuted, unlockAudio, unlockSpeech } from "../lib/audio";
import { submitLog } from "../lib/log-queue";
import { acquireWakeLock, releaseWakeLock } from "../lib/wake-lock";
import {
  buildTimeline,
  initialState,
  jumpToFinal,
  nextUp,
  ownerOf,
  plannedSec,
  prefillReps,
  remainingSec,
  roundLogs,
  roundMeters,
  rowedRounds,
  saveRecord,
  skip,
  suggestDnf,
  summaryLine,
  summaryLog,
  tick,
  togglePause,
  type Lever,
  type LogOwner,
  type RcKind,
  unitOf,
  VERB,
  type RcEvent,
  type RcItem,
  type RcPrescription,
  type RcState,
  type RecordEntry,
  type RestMode,
} from "../lib/row-circuit";

// ---------------------------------------------------------------------------
// ROW-CIRCUIT — the start screen, the running screen and the record card.
//
// Start: pick rounds, pick "+1 stroke/min" or "+0:15 each round" (the default
// is the lever that didn't move last time), Start. Then hands-free except one
// record card per round, prefilled, saved with one tap when nothing changed.
// Each round is logged as soon as its card is saved, so stopping early still
// keeps every finished round.
//
// ROW-LADDER (kind "ladder"): the same start screen and progression, rows and
// rest minutes only, and ONE card at the end — a card every round would stop
// the rowing. "End early" goes straight to that card, so rounds already rowed
// are recorded rather than lost. Launched from Sessions, or as the day's
// planned rower cardio (then `planId` is set and every log attaches to it).
// ---------------------------------------------------------------------------

interface Props {
  kind?: RcKind;
  /** The day's planned row this session IS, when launched from Today. */
  planId?: number | null;
  onRunningChange?: (running: boolean) => void;
  onExit?: () => void;
}

const TICK_MS = 250;

/** Which figure an item shows. Anything on the rower is the rowing machine; a
 * transition previews the move it leads into, so he sees it before he gets
 * there; a station is itself. */
function figureFor(items: RcItem[], index: number, machine: string | null = "Rowing machine"): string | null {
  const it = items[index];
  if (it.kind === "row" || it.kind === "rest" || it.kind === "cooldown" || it.kind === "get_set") {
    return machine;
  }
  if (it.kind === "station") return it.name;
  if (it.kind === "move") {
    const next = nextUp(items, index);
    if (!next) return null;
    return next.kind === "station" ? next.name : machine;
  }
  return null;
}

/** QUICK-START: the figure for the machine. The treadmill borrows the jog;
 * there is no bike figure yet, so a ride shows none rather than a wrong one. */
const MACHINE_FIGURE: Record<RcKind, string | null> = {
  circuit: "Rowing machine", ladder: "Rowing machine", ride: null, run: "Jog in place",
};
type Phase = "ready" | "running" | "done";
type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "unavailable"; reason: string }
  | { state: "ok"; rx: RcPrescription };

const LEVER_ORDER: Lever[] = ["rate", "time"];

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const TITLES: Record<RcKind, string> = {
  circuit: "Row circuit", ladder: "Row ladder", ride: "Ride ladder", run: "Run ladder",
};

export default function RowCircuitScreen({ kind = "circuit", planId = null, onRunningChange, onExit }: Props) {
  const [rounds, setRounds] = useState<number | null>(null);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [lever, setLever] = useState<Lever | null>(null);
  const [restMode, setRestMode] = useState<RestMode>("easy");
  const [phase, setPhase] = useState<Phase>("ready");

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    void fetchRowCircuit(rounds, kind).then((r) => {
      if (!live) return;
      if (r.status === "error") return setLoad({ state: "error", message: r.message });
      if (!r.data.available) return setLoad({ state: "unavailable", reason: r.data.reason });
      setLoad({ state: "ok", rx: r.data });
      setRounds(r.data.rounds);
      setLever(r.data.default);
    });
    return () => { live = false; };
  }, [rounds, kind]);

  useEffect(() => { onRunningChange?.(phase === "running"); }, [phase, onRunningChange]);
  useEffect(() => () => onRunningChange?.(false), [onRunningChange]);

  if (load.state === "loading" && phase === "ready") {
    return <div className="screen screen--center"><div className="h2 dim">Loading the {TITLES[kind].toLowerCase()}…</div></div>;
  }
  if (load.state === "error" || load.state === "unavailable") {
    return (
      <div className="screen screen--center" data-testid="rc-unavailable">
        <div className="h1">{TITLES[kind]}</div>
        <div className="desc">
          {load.state === "error" ? `Couldn't load today's rounds: ${load.message}` : load.reason}
        </div>
        {onExit && <button type="button" className="btn" onClick={onExit}>Back</button>}
      </div>
    );
  }
  if (load.state !== "ok" || !lever) return null;
  const rx = load.rx;

  if (phase === "ready") {
    return (
      <ReadyScreen
        rx={rx} lever={lever} restMode={restMode}
        onRounds={(n) => setRounds(n)} onLever={setLever} onRestMode={setRestMode}
        onStart={() => {
          // Inside the tap: iOS unlocks audio, speech and the wake lock only
          // from a user gesture, so this cannot move into the run screen's effect.
          void unlockAudio();
          unlockSpeech();
          void acquireWakeLock();
          setPhase("running");
        }}
      />
    );
  }
  return (
    <RunScreen rx={rx} lever={lever} restMode={restMode} owner={ownerOf(rx, planId)}
      onDone={() => setPhase("done")} done={phase === "done"} onExit={onExit} />
  );
}

// ---------------------------------------------------------------------------

function ReadyScreen({ rx, lever, restMode, onRounds, onLever, onRestMode, onStart }: {
  rx: RcPrescription; lever: Lever; restMode: RestMode;
  onRounds: (n: number) => void; onLever: (l: Lever) => void;
  onRestMode: (m: RestMode) => void; onStart: () => void;
}) {
  const items = useMemo(() => buildTimeline(rx, lever, restMode), [rx, lever, restMode]);
  const chosen = rx.options[lever];
  return (
    <div className="screen screen--scroll rc-ready" data-testid="rc-ready">
      <div className="h1">{rx.display_name}</div>
      <div className="h2 dim">
        ~{Math.round(plannedSec(items) / 60)} min · {rx.rounds} rounds · {Math.round(chosen.row_sec / 60)} min rowing
      </div>

      <div className="rc-rounds">
        <Stepper label="Rounds" value={rx.rounds} step={1} min={rx.min_rounds} max={rx.max_rounds}
          onChange={(v) => { if (v != null) onRounds(v); }} />
      </div>

      <div className="rc-options" role="radiogroup" aria-label="Progression">
        {LEVER_ORDER.map((lv) => {
          const o = rx.options[lv];
          return (
            <button key={lv} type="button" role="radio" aria-checked={lever === lv}
              data-testid={`rc-option-${lv}`}
              className={`btn rc-option${lever === lv ? " rc-option--on" : ""}`}
              disabled={!o.ok} onClick={() => onLever(lv)}>
              <span className="rc-option-head">
                {lv === "rate"
                  ? (unitOf(rx) === "bpm" ? `+${rx.step ?? 5} bpm` : "+1 stroke/min")
                  : (rx.time_label ?? "+1:00 each round")}
                {rx.default === lv && <span className="chip rc-default">default</span>}
              </span>
              <span className="rc-option-body mono">{summaryLine(o)}</span>
              {!o.ok && <span className="rc-option-why">{o.reason}</span>}
            </button>
          );
        })}
      </div>
      <button type="button" data-testid="rc-option-repeat"
        className={`btn rc-repeat${lever === "repeat" ? " rc-option--on" : ""}`}
        onClick={() => onLever("repeat")}>
        Same as last time · <span className="mono">{summaryLine(rx.options.repeat)}</span>
      </button>
      <p className="desc dim" data-testid="rc-why">{rx.why}</p>
      {rx.extrapolated_note && (
        <p className="desc rc-extrapolated" data-testid="rc-extrapolated">{rx.extrapolated_note}</p>
      )}

      <button type="button" className="btn rc-restmode" data-testid="rc-restmode"
        onClick={() => onRestMode(restMode === "easy" ? "stopped" : "easy")}>
        Rest minute: {restMode === "easy" ? `easy at ${rx.rest.rate}` : "stopped"}
      </button>

      <ol className="rc-plan">
        {chosen.rounds.map((r, i) => (
          <li key={r.round}>
            <span className="mono">R{r.round}{rx.extrapolated?.includes(r.round) ? " · new" : ""}</span>
            <span>{VERB[rx.kind].act} {clock(r.work_sec)} @ {r.spm}{unitOf(rx) === "bpm" ? " bpm" : ""}</span>
            {(rx.stations[i] ?? []).length > 0 && (
              <span className="dim">{(rx.stations[i] ?? []).map((s) => s.name).join(" · ")}</span>
            )}
          </li>
        ))}
      </ol>
      <p className="desc">
        {unitOf(rx) === "bpm"
          ? `Start a ${rx.kind === "ride" ? "Cycling" : "Running"} workout on your watch — the target is your heart rate — then Start.`
          : "Reset the rower's monitor and start a Rowing workout on your watch, then Start."}
        {rx.kind === "ladder"
          ? " One record card at the end, prefilled — tap Save if you held every rate."
          : " One record card per round, prefilled — tap Save if nothing changed."}
      </p>
      <button type="button" className="btn btn--primary btn--block rc-start" data-testid="rc-start"
        onClick={onStart}>Start</button>
    </div>
  );
}

// ---------------------------------------------------------------------------

type LogStatus = "idle" | "ok" | "queued" | "error";

function RunScreen({ rx, lever, restMode, owner, onDone, done, onExit }: {
  rx: RcPrescription; lever: Lever; restMode: RestMode; owner: LogOwner;
  onDone: () => void; done: boolean; onExit?: () => void;
}) {
  const items = useMemo(() => buildTimeline(rx, lever, restMode), [rx, lever, restMode]);
  const target = rx.options[lever].rounds;
  const [state, setState] = useState<RcState>(() => initialState(Date.now()));
  const stateRef = useRef(state);
  const lastRef = useRef(0);
  const startedRef = useRef(false);
  const summaryLoggedRef = useRef(false);
  const [entries, setEntries] = useState<Record<number, RecordEntry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const recordedRef = useRef(0);
  const [logStatus, setLogStatus] = useState<LogStatus>("idle");
  /** Ladder: the monitor's total from the final card, for the summary row. */
  const totalMetersRef = useRef<number | null>(null);
  const [ladderSaved, setLadderSaved] = useState<number | null>(null);
  const audio = useSyncExternalStore(subscribeAudio, audioStatus, audioStatus);

  const commit = useCallback((s: RcState) => { stateRef.current = s; setState(s); }, []);

  const logSummary = useCallback(async (keepalive: boolean) => {
    if (summaryLoggedRef.current) return;
    if (stateRef.current.elapsedMs < 1000) return;
    summaryLoggedRef.current = true;
    const r = await submitLog(
      summaryLog(stateRef.current, target.length, lever, recordedRef.current, owner, totalMetersRef.current),
      { keepalive });
    if (!keepalive) setLogStatus((cur) => (cur === "error" ? cur : r.status === "error" ? "error" : r.status));
  }, [target.length, lever, owner]);

  const handle = useCallback((events: RcEvent[]) => {
    for (const e of events) {
      if (e.type === "start") speak(items[e.index].say);
      else if (e.type === "warn") speak("Five seconds.");
      else if (e.type === "done") {
        speak(`${rx.display_name} complete.`);
        void releaseWakeLock();
        void logSummary(false);
        onDone();
      }
    }
  }, [items, logSummary, onDone, rx.display_name]);

  // Audio was unlocked by the Start tap (see RowCircuitScreen); this only
  // stamps the real start time and says the first line.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const s = initialState(Date.now());
    commit(s);
    speak(items[0].say);
  }, [commit, items]);

  useEffect(() => {
    if (done) return;
    lastRef.current = performance.now();
    const id = window.setInterval(() => {
      const t = performance.now();
      const dt = t - lastRef.current;
      lastRef.current = t;
      const { state: next, events } = tick(items, stateRef.current, dt, Date.now());
      if (next !== stateRef.current) commit(next);
      if (events.length) handle(events);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [done, items, commit, handle]);

  // Leaving mid-session: every saved round is already logged; record the
  // partial summary and pause.
  useEffect(() => {
    function away() {
      const s = stateRef.current;
      if (s.done) return;
      void logSummary(true);
      if (!s.paused) { commit({ ...s, paused: true }); stopSpeech(); }
    }
    function onVis() { if (document.visibilityState === "hidden") away(); }
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", away);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", away);
    };
  }, [commit, logSummary]);

  useEffect(() => () => { stopSpeech(); void releaseWakeLock(); }, []);

  async function onSave(entry: RecordEntry) {
    const s = stateRef.current;
    const item = items[s.index];
    if (item.kind !== "record" || item.round == null) return;
    const round = item.round;
    const prevTotal = [...Object.entries(entriesRef.current)]
      .filter(([r]) => Number(r) < round)
      .map(([, e]) => e.metersTotal)
      .filter((m): m is number => m != null)
      .pop() ?? null;
    const meters = roundMeters(entry.metersTotal, prevTotal);
    const tgt = target[round - 1];
    // End the card first so its own window closes at the tap, then log.
    const { state: next, events } = saveRecord(items, s, Date.now());
    commit(next);
    setEntries((cur) => ({ ...cur, [round]: entry }));
    recordedRef.current += 1;
    handle(events);
    for (const body of roundLogs(items, s, round, entry, meters, tgt, owner)) {
      const r = await submitLog(body);
      if (r.status === "error") setLogStatus("error");
      else setLogStatus((cur) => (cur === "error" ? cur : r.status));
    }
  }

  /** Ladder: the one card at the end — every rowed round's rate, and the
   * monitor's total. Logs first, then ends the card, so the summary that the
   * done event writes already knows the total and the round count. */
  async function onSaveFinal(
    spms: Record<number, number>, metersTotal: number | null,
    dnfs: Record<number, { dnf: boolean; heldSec: number | null }> = {},
  ) {
    const s = stateRef.current;
    if (items[s.index].kind !== "record" || items[s.index].round != null) return;
    const rounds = rowedRounds(items, s);
    totalMetersRef.current = metersTotal;
    recordedRef.current = rounds.length;
    setLadderSaved(rounds.length);
    const bodies = rounds.flatMap((r) => roundLogs(
      items, s, r, { spm: spms[r] ?? target[r - 1].spm, metersTotal: null, reps: {},
                     dnf: dnfs[r]?.dnf ?? false, heldSec: dnfs[r]?.heldSec ?? null }, null,
      target[r - 1], owner));
    const { state: next, events } = saveRecord(items, s, Date.now());
    commit(next);
    handle(events);
    for (const body of bodies) {
      const r = await submitLog(body);
      if (r.status === "error") setLogStatus("error");
      else setLogStatus((cur) => (cur === "error" ? cur : r.status));
    }
  }

  if (done) {
    const recs = Object.entries(entries);
    const totals: Record<string, number> = {};
    for (const [, e] of recs) {
      for (const [k, v] of Object.entries(e.reps)) if (v != null) totals[k] = (totals[k] ?? 0) + v;
    }
    const lastTotal = totalMetersRef.current
      ?? recs.map(([, e]) => e.metersTotal).filter((m): m is number => m != null).pop();
    const recorded = ladderSaved ?? recs.length;
    return (
      <div className="screen screen--center rc-done" data-testid="rc-done">
        <div className="h1">{rx.display_name} complete</div>
        <div className="h2 dim">
          {Math.floor(state.elapsedMs / 60000)} min · {recorded} of {target.length} rounds recorded
          {lastTotal != null ? ` · ${lastTotal} m` : ""}
        </div>
        <ul className="list">
          {Object.entries(totals).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
        </ul>
        <div className="desc" data-testid="rc-log-status">
          {logStatus === "ok" ? "Logged ✓"
            : logStatus === "queued" ? "Saved offline ✓ — will sync"
            : logStatus === "error" ? "Some rows couldn't log — check Status"
            : "Logging…"}
        </div>
        <p className="desc dim">Heart rate per round arrives once the watch has synced.</p>
        {onExit && <button type="button" className="btn" onClick={onExit}>Done</button>}
      </div>
    );
  }

  const item: RcItem = items[state.index];
  const left = remainingSec(items, state);
  const next = nextUp(items, state.index);
  const roundLabel = item.round != null ? `Round ${item.round}/${target.length}`
    : item.kind === "record" ? "Record" : "Cool-down";

  return (
    <div className={`screen rc-run rc-run--${item.kind}${state.paused ? " rc-run--paused" : ""}`}
      data-testid="rc-run" data-kind={item.kind} data-index={state.index}
      onClick={(e) => {
        if (item.kind === "record") return;
        if ((e.target as HTMLElement).closest("[data-no-tap]")) return;
        commit(togglePause(items, stateRef.current));
        lastRef.current = performance.now();
        if (!stateRef.current.paused) stopSpeech();
      }}>
      <div className="rc-head">
        <span data-testid="rc-round">{roundLabel}</span>
        <span className="mono dim">{clock(Math.floor(state.elapsedMs / 1000))}</span>
        {audio !== "unsupported" && (
          <button type="button" className="badge badge--button" data-no-tap
            onClick={() => { toggleMuted(); if (isMuted()) stopSpeech(); }}
            aria-label={isMuted() ? "Muted — tap for sound" : "Sound on — tap to mute"}>
            {isMuted() ? "🔇" : "🔊"}
          </button>
        )}
      </div>

      {item.kind === "record" && item.round == null ? (
        <FinalCard
          rx={rx} target={target} rounds={rowedRounds(items, state)}
          suggested={Object.fromEntries(rowedRounds(items, state).map((r) => [r, suggestDnf(items, state, r)]))}
          elapsedSec={Math.floor(state.stageMs / 1000)}
          onSave={(spms, total, dnfs) => void onSaveFinal(spms, total, dnfs)}
        />
      ) : item.kind === "record" && item.round != null ? (
        <RecordCard
          key={item.round}
          rx={rx} round={item.round} target={target[item.round - 1]}
          stations={rx.stations[item.round - 1] ?? []}
          suggested={suggestDnf(items, state, item.round)}
          entries={entries} elapsedSec={Math.floor(state.stageMs / 1000)}
          onSave={(e) => void onSave(e)}
        />
      ) : (
        <div className="rc-body">
          {(() => {
            const fig = figureFor(items, state.index, MACHINE_FIGURE[rx.kind]);
            return fig ? <MoveFigure name={fig} className="rc-figure" /> : null;
          })()}
          <div className="rc-name" data-testid="rc-name">{item.name}</div>
          {item.spm != null && (
            <div className="rc-spm mono" data-testid="rc-spm">
              {item.spm}<span className="rc-spm-unit">{unitOf(rx)}</span>
            </div>
          )}
          <div className="rc-clock mono" data-testid="rc-clock">{left != null ? clock(left) : ""}</div>
          {item.cue && <div className="rc-cue">{item.cue}</div>}
          <button type="button" className="btn rc-skip" data-no-tap data-testid="rc-skip"
            onClick={() => {
              const { state: s2, events } = skip(items, stateRef.current, Date.now());
              commit(s2); handle(events);
            }}>Skip ›</button>
          {rx.kind === "ladder" && (
            <button type="button" className="btn rc-skip rc-end" data-no-tap data-testid="rc-end-early"
              onClick={() => {
                const { state: s2, events } = jumpToFinal(items, stateRef.current, Date.now());
                commit(s2); handle(events);
              }}>End early — record</button>
          )}
        </div>
      )}

      <div className="rc-next" data-testid="rc-next">
        {next ? `Next: ${next.name}` : "Last one"}
      </div>
      {state.paused && <div className="flow-paused" data-testid="rc-paused">Paused — tap to resume</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecordCard({ rx, round, target, stations, entries, elapsedSec, onSave, suggested }: {
  rx: RcPrescription; round: number; target: { spm: number; work_sec: number };
  stations: RcPrescription["stations"][number];
  entries: Record<number, RecordEntry>; elapsedSec: number;
  onSave: (e: RecordEntry) => void;
  suggested: { dnf: boolean; heldSec: number | null };
}) {
  const [dnf, setDnf] = useState<boolean>(suggested.dnf);
  const [heldSec, setHeldSec] = useState<number | null>(suggested.heldSec);
  const thisSession = useMemo(() => {
    const out: Record<number, Record<string, number | null>> = {};
    for (const [r, e] of Object.entries(entries)) out[Number(r)] = e.reps;
    return out;
  }, [entries]);
  const prevTotal = Object.values(entries).map((e) => e.metersTotal)
    .filter((m): m is number => m != null).pop() ?? null;
  const [spm, setSpm] = useState<number>(target.spm);
  const [metersTotal, setMetersTotal] = useState<number | null>(null);
  const [reps, setReps] = useState<Record<string, number | null>>(() => {
    const o: Record<string, number | null> = {};
    for (const s of stations) if (s.format === "reps") o[s.name] = prefillReps(rx, round, s.name, thisSession);
    return o;
  });
  const meters = roundMeters(metersTotal, prevTotal);
  const below = metersTotal != null && prevTotal != null && metersTotal < prevTotal;

  return (
    <div className="rc-record" data-testid="rc-record" data-no-tap>
      <div className="rc-record-head">
        <span className="h2">Record round {round}</span>
        <span className={`mono${elapsedSec > 10 ? " rc-record-late" : " dim"}`}>{elapsedSec}s</span>
      </div>
      <div className="rc-record-grid">
        <Stepper label={VERB[rx.kind].act} unit={unitOf(rx)} value={spm} step={1}
          min={rx.value_min ?? 10} max={rx.value_max ?? 60}
          onChange={(v) => { if (v != null) setSpm(v); }}
          sub={spm !== target.spm ? `target ${target.spm}` : undefined} />
        <DnfToggle dnf={dnf} onChange={setDnf} heldSec={heldSec} onHeld={setHeldSec}
          targetSec={target.work_sec} />
        <Stepper label="Monitor total" unit="m" value={metersTotal} step={10} min={0} max={99999}
          blankStart={prevTotal ?? 0} onChange={setMetersTotal}
          sub={below ? "below last round's total — not counted"
            : meters != null ? `${meters} m this round` : "optional — tap to type"} />
        {stations.filter((s) => s.format === "reps").map((s) => (
          <Stepper key={s.name} label={s.name} unit="reps" value={reps[s.name] ?? null} step={1}
            min={0} max={200} blankStart={10}
            onChange={(v) => setReps((cur) => ({ ...cur, [s.name]: v }))} />
        ))}
      </div>
      <button type="button" className="btn btn--primary btn--block rc-save" data-testid="rc-save"
        onClick={() => onSave({ spm, metersTotal, reps, dnf, heldSec: dnf ? heldSec : null })}>
        Save · next round
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FinalCard({ rx, target, rounds, elapsedSec, onSave, suggested }: {
  rx: RcPrescription; target: { round: number; spm: number; work_sec: number }[];
  rounds: number[]; elapsedSec: number;
  onSave: (spms: Record<number, number>, metersTotal: number | null,
           dnfs: Record<number, { dnf: boolean; heldSec: number | null }>) => void;
  suggested: Record<number, { dnf: boolean; heldSec: number | null }>;
}) {
  const [dnfs, setDnfs] = useState<Record<number, { dnf: boolean; heldSec: number | null }>>(() => {
    const o: Record<number, { dnf: boolean; heldSec: number | null }> = {};
    for (const r of rounds) o[r] = suggested[r] ?? { dnf: false, heldSec: null };
    return o;
  });
  const [spms, setSpms] = useState<Record<number, number>>(() => {
    const o: Record<number, number> = {};
    for (const r of rounds) o[r] = target[r - 1].spm;
    return o;
  });
  const [metersTotal, setMetersTotal] = useState<number | null>(null);
  return (
    <div className="rc-record" data-testid="rc-final" data-no-tap>
      <div className="rc-record-head">
        <span className="h2">Record the {rx.display_name.toLowerCase()}</span>
        <span className="mono dim">{elapsedSec}s</span>
      </div>
      {rounds.length === 0 && <p className="desc">No round was finished, so there is nothing to record.</p>}
      <div className="rc-record-grid">
        {rounds.map((r) => (
          <div key={r} className="rc-final-round">
            <Stepper label={`Round ${r}`} unit={unitOf(rx)} value={spms[r]} step={1}
              min={unitOf(rx) === "bpm" ? 60 : 10} max={unitOf(rx) === "bpm" ? 220 : 60}
              onChange={(v) => { if (v != null) setSpms((cur) => ({ ...cur, [r]: v })); }}
              sub={spms[r] !== target[r - 1].spm ? `target ${target[r - 1].spm}` : undefined} />
            <DnfToggle dnf={dnfs[r]?.dnf ?? false} heldSec={dnfs[r]?.heldSec ?? null}
              targetSec={target[r - 1].work_sec} testId={`rc-dnf-${r}`}
              onChange={(v) => setDnfs((cur) => ({ ...cur, [r]: { ...(cur[r] ?? { heldSec: null }), dnf: v } }))}
              onHeld={(v) => setDnfs((cur) => ({ ...cur, [r]: { ...(cur[r] ?? { dnf: true }), heldSec: v } }))} />
          </div>
        ))}
        <Stepper label="Monitor total" unit="m" value={metersTotal} step={10} min={0} max={99999}
          blankStart={0} onChange={setMetersTotal} sub="optional — tap to type" />
      </div>
      <button type="button" className="btn btn--primary btn--block rc-save" data-testid="rc-save-final"
        onClick={() => onSave(spms, metersTotal, dnfs)}>
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** ROW-DNF: one tap. "Finished" by default; tapping it says he didn't finish
 * the row at its target, which holds the next session at the same targets.
 * Prefilled when he paused in the row or cut it short. */
function DnfToggle({ dnf, onChange, heldSec, onHeld, targetSec, testId = "rc-dnf" }: {
  dnf: boolean; onChange: (v: boolean) => void;
  heldSec: number | null; onHeld: (v: number | null) => void;
  targetSec: number; testId?: string;
}) {
  return (
    <div className="rc-dnf">
      <button type="button" data-testid={testId} aria-pressed={dnf}
        className={`btn rc-dnf-btn${dnf ? " rc-dnf-btn--on" : ""}`}
        onClick={() => onChange(!dnf)}>
        {dnf ? "Didn't finish" : "Finished ✓"}
      </button>
      {dnf && (
        <Stepper label="Held for" unit="s" value={heldSec} step={5} min={0} max={targetSec}
          blankStart={Math.min(60, targetSec)} onChange={onHeld}
          sub="optional — next time repeats this target" />
      )}
    </div>
  );
}
