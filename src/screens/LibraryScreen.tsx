import { useEffect, useMemo, useState } from "react";
import { fetchLibrary, fetchStrengthNext, postMakeup } from "../lib/api";
import { ADHOC_PLAN_ID } from "../lib/adhoc";
import type { LibraryLocation, LibraryResponse, LibrarySession, Plan } from "../lib/types";

// ---------------------------------------------------------------------------
// SESSION-LIB — start any session on demand.
//
// * Buttons are session TYPES; the location decides which appear. What a
//   location can't support is ABSENT, not greyed — the library the box builds
//   only lists what each place can hold.
// * The location defaults to where the cycle says Ryan is today, shown as a
//   chip. Tapping it picks another for THIS launch only; nothing is saved.
// * Every session is the seeder's own row for today's program week.
// ---------------------------------------------------------------------------

interface Props {
  onLaunch: (plan: Plan, sessionType: string) => void;
  /** MAKEUP-2: today's rest row is now the made-up session — go run it. */
  onMadeUp?: () => void;
  /** PAIN-1: today is a check-in day off — only gentle mobility is offered.
   * Read live from today's row: the library is built at 00:20, before the
   * check-in could have made the day a day off. */
  dayOff?: boolean;
  /** ROW-CIRCUIT: open the rower circuit. Absent = not offered. */
  onOpenRowCircuit?: () => void;
  /** ROW-LADDER: open the rower-only ladder. */
  onOpenRowLadder?: () => void;
  /** QUICK-START: open a ride or run ladder. */
  onOpenLadder?: (kind: "ride" | "run") => void;
}

/** QUICK-START buttons for these library session types; the Extras list below
 * leaves out strength, which only the Strength button opens. */
const STRENGTH_TYPES = new Set(["strength_a", "strength_b", "strength_c"]);
/** On a Start button, so not repeated under More. */
const ON_A_BUTTON = new Set(["recovery_flow", "yoga_strength"]);
const STRENGTH_LETTER: Record<string, string> = { strength_a: "A", strength_b: "B", strength_c: "C" };

/** On a pain day off, only these extras. */
const DAY_OFF_TYPES = new Set(["mobility"]);

function dayName(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; data: LibraryResponse };

/** A launchable Plan: the library entry with the ad-hoc placeholder id. */
export function planFromLibrary(s: LibrarySession, today: string): Plan {
  return {
    plan_id: ADHOC_PLAN_ID,
    plan_date: today,
    phase: s.phase,
    week_num: s.week_num,
    session_type: s.session_type as Plan["session_type"],
    target_rpe: (s.target_rpe ?? 0) as number,
    est_duration_min: (s.est_duration_min ?? 0) as number,
    is_skipped: false,
    blocks: s.blocks,
  };
}

export default function LibraryScreen({ onLaunch, onMadeUp, dayOff = false, onOpenRowCircuit, onOpenRowLadder,
                                       onOpenLadder }: Props) {
  const [nextStrength, setNextStrength] = useState<string | null>(null);
  const [strengthErr, setStrengthErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void fetchStrengthNext().then((r) => {
      if (!live) return;
      if (r.status === "ok") setNextStrength(r.session_type);
      else setStrengthErr(r.message);
    });
    return () => { live = false; };
  }, []);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [makeup, setMakeup] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [locKey, setLocKey] = useState<string | null>(null);   // null = today's
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLibrary().then((r) => {
      if (cancelled) return;
      setLoad(r.status === "ok" ? { state: "ok", data: r.data } : { state: "error", message: r.message });
    });
    return () => { cancelled = true; };
  }, []);

  const lib = load.state === "ok" && load.data.available ? load.data : null;
  const location: LibraryLocation | null = useMemo(() => {
    if (!lib) return null;
    const key = locKey ?? lib.today_location_key;
    return lib.locations.find((l) => l.key === key) ?? null;
  }, [lib, locKey]);

  if (load.state === "loading") {
    return <div className="screen screen--center"><div className="h2 dim">Loading sessions…</div></div>;
  }
  if (load.state === "error") {
    return (
      <div className="screen screen--center">
        <div className="h1">Sessions</div>
        <div className="desc">Couldn't load the session library: {load.message}</div>
      </div>
    );
  }
  if (!load.data.available) {
    return (
      <div className="screen screen--center">
        <div className="h1">Sessions</div>
        <div className="desc">{load.data.reason}</div>
      </div>
    );
  }
  const data = load.data;
  const isToday = (locKey ?? data.today_location_key) === data.today_location_key;

  return (
    <div className="screen screen--scroll library">
      <div className="h1">Start a session</div>
      {data.makeup?.offer && !dayOff && (
        <div className="log-card library-makeup">
          <div className="log-card-name">Make up {data.makeup.offer.display_name}</div>
          <p className="desc">
            Not done on {dayName(data.makeup.offer.missed_date)}. Doing it today makes
            that day a rest day and today this session.
          </p>
          {makeup.error && <div className="log-error">{makeup.error}</div>}
          <button
            type="button"
            className="btn btn--block"
            disabled={makeup.busy}
            onClick={async () => {
              const o = data.makeup!.offer!;
              setMakeup({ busy: true, error: null });
              const r = await postMakeup(o.missed_plan_id, o.rest_plan_id);
              if (r.status === "ok") { setMakeup({ busy: false, error: null }); onMadeUp?.(); }
              else setMakeup({ busy: false, error: r.message });
            }}
          >
            {makeup.busy ? "Swapping…" : `Make it up today`}
          </button>
        </div>
      )}
      {!data.makeup?.offer && data.makeup?.offer_blocked && (
        <p className="desc">{data.makeup.offer_blocked}, so it can't be made up here today.</p>
      )}
      {data.makeup?.repeat && (
        <p className="desc">
          {data.makeup.not_done.length} sessions not done this week
          ({data.makeup.not_done.map((m) => `${dayName(m.plan_date)} ${m.display_name}`).join(", ")}).
          The week repeats — Artemis will ask you to confirm.
        </p>
      )}
      {dayOff && (
        <p className="desc">Day off from the check-in — gentle mobility only today.</p>
      )}
      <div className="library-loc">
        <button
          type="button"
          className="chip chip--on"
          aria-label="Change location for this session"
          onClick={() => setPicking((p) => !p)}
        >
          {location ? location.display : "Unknown location"}
          {isToday ? " · today" : " · this session only"} ▾
        </button>
      </div>
      {picking && (
        <div className="chip-row library-loc-pick" role="group" aria-label="Locations">
          {data.locations.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`chip${l.key === location?.key ? " chip--on" : ""}`}
              onClick={() => { setLocKey(l.key === data.today_location_key ? null : l.key); setPicking(false); }}
            >
              {l.display}
            </button>
          ))}
        </div>
      )}
      {data.stale && (
        <p className="desc dim">
          Built for {data.generated_on}, not today — the program week may have moved.
        </p>
      )}
      {location && !dayOff && (
        <QuickStart
          location={location} today={data.today} nextStrength={nextStrength} strengthErr={strengthErr}
          onLaunch={onLaunch} onOpenRowCircuit={onOpenRowCircuit} onOpenRowLadder={onOpenRowLadder}
          onOpenLadder={onOpenLadder}
        />
      )}
      <h3 className="section-title library-extras-title">More</h3>
      {!location ? (
        <p className="desc">Today's location isn't in the library.</p>
      ) : location.sessions.length === 0 ? (
        <p className="desc">No extras can be run at {location.display} yet.</p>
      ) : (
        <div className="library-list">
          {location.sessions.filter((s) => !STRENGTH_TYPES.has(s.session_type)
                                  && (dayOff || !ON_A_BUTTON.has(s.session_type)))
            .filter((s) => !dayOff || DAY_OFF_TYPES.has(s.session_type)).map((s) => (
            <button
              key={s.session_type}
              type="button"
              className="btn btn--block library-item"
              onClick={() => onLaunch(planFromLibrary(s, data.today), s.session_type)}
            >
              <span className="library-name">{s.display_name}</span>
              {s.est_duration_min ? <span className="library-min mono">{s.est_duration_min} min</span> : null}
            </button>
          ))}
        </div>
      )}
      <p className="desc dim library-foot">
        Extras are low-impact work on top of the plan — they count toward your
        history, never against it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QUICK-START (Ryan, 2026-10-20): "avoid overly complicated automation. Give me
// buttons to decide what I want to do and when."
//
//   Cardio:   Row (+ floor) · Ride · Run   — the same ladder, spm or bpm
//   Strength: next in the A → B → C rotation, built for the room picked above
//   Yoga — Intense · Recovery
//
// A button whose session the room can't hold is absent, not greyed — the
// library's own rule. The cardio buttons are always offered: he is the one
// standing next to the machine.
// ---------------------------------------------------------------------------

function QuickStart({ location, today, nextStrength, strengthErr, onLaunch, onOpenRowCircuit,
                      onOpenRowLadder, onOpenLadder }: {
  location: LibraryLocation; today: string; nextStrength: string | null; strengthErr: string | null;
  onLaunch: Props["onLaunch"]; onOpenRowCircuit?: () => void; onOpenRowLadder?: () => void;
  onOpenLadder?: (kind: "ride" | "run") => void;
}) {
  const find = (t: string) => location.sessions.find((s) => s.session_type === t) ?? null;
  const strength = nextStrength ? find(nextStrength) : null;
  const hasAnyStrength = location.sessions.some((s) => STRENGTH_TYPES.has(s.session_type));
  const yoga = find("yoga_strength");
  const recovery = find("recovery_flow");
  const launch = (s: LibrarySession) => onLaunch(planFromLibrary(s, today), s.session_type);
  return (
    <section className="quick-start" data-testid="quick-start" aria-label="Start a workout">
      <h2 className="section-title">Start</h2>
      <div className="quick-row" role="group" aria-label="Cardio">
        {onOpenRowLadder && (
          <button type="button" className="btn quick-btn" data-testid="quick-row" onClick={onOpenRowLadder}>
            <span className="quick-name">Row</span><span className="quick-sub">ladder · spm</span>
          </button>
        )}
        {onOpenRowCircuit && (
          <button type="button" className="btn quick-btn" data-testid="quick-row-circuit" onClick={onOpenRowCircuit}>
            <span className="quick-name">Row + floor</span><span className="quick-sub">circuit</span>
          </button>
        )}
        {onOpenLadder && (
          <>
            <button type="button" className="btn quick-btn" data-testid="quick-ride" onClick={() => onOpenLadder("ride")}>
              <span className="quick-name">Ride</span><span className="quick-sub">ladder · bpm</span>
            </button>
            <button type="button" className="btn quick-btn" data-testid="quick-run" onClick={() => onOpenLadder("run")}>
              <span className="quick-name">Run</span><span className="quick-sub">ladder · bpm</span>
            </button>
          </>
        )}
      </div>
      <div className="quick-row" role="group" aria-label="Strength, yoga and recovery">
        {strength ? (
          <button type="button" className="btn quick-btn" data-testid="quick-strength" onClick={() => launch(strength)}>
            <span className="quick-name">Strength {STRENGTH_LETTER[strength.session_type]}</span>
            <span className="quick-sub">next · {location.display}</span>
          </button>
        ) : hasAnyStrength && strengthErr ? (
          <p className="desc dim" data-testid="quick-strength-error">
            Strength: couldn't tell which session is next ({strengthErr}).
          </p>
        ) : null}
        {yoga && (
          <button type="button" className="btn quick-btn" data-testid="quick-yoga" onClick={() => launch(yoga)}>
            <span className="quick-name">Yoga — Intense</span>
            <span className="quick-sub">{yoga.est_duration_min ? `${yoga.est_duration_min} min` : "strength & balance"}</span>
          </button>
        )}
        {recovery && (
          <button type="button" className="btn quick-btn" data-testid="quick-recovery" onClick={() => launch(recovery)}>
            <span className="quick-name">Recovery</span>
            <span className="quick-sub">{recovery.est_duration_min ? `${recovery.est_duration_min} min` : "flow"}</span>
          </button>
        )}
      </div>
    </section>
  );
}
