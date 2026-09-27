import { useEffect, useMemo, useState } from "react";
import { fetchLibrary } from "../lib/api";
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

export default function LibraryScreen({ onLaunch }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
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
      {!location ? (
        <p className="desc">Today's location isn't in the library.</p>
      ) : location.sessions.length === 0 ? (
        <p className="desc">Nothing can be run at {location.display} yet.</p>
      ) : (
        <div className="library-list">
          {location.sessions.map((s) => (
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
        Sets count toward your history. If today has an unfinished session of the
        same type, this completes it.
      </p>
    </div>
  );
}
