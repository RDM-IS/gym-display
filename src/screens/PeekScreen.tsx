import { useEffect, useState } from "react";
import PlanDayDetail, { sessionName, totalMinutes } from "../components/PlanDayDetail";
import { fetchPlanRange, type FetchPlanRangeResult } from "../lib/api";
import type { PlanDay } from "../lib/types";
import {
  addDays,
  asOfLabel,
  dayLabel,
  deviceTodayIso,
  programWeekStart,
  shiftWeek,
  statusIcon,
  tomorrowOf,
  weekDates,
  weekHeading,
} from "../lib/week";

export type PeekMode = "tomorrow" | "week";

interface Props {
  mode: PeekMode;
  onBack: () => void;
  /** Injected in tests; defaults to the device date. */
  deviceToday?: string;
}

type Load = { loading: true } | { loading: false; result: FetchPlanRangeResult };

/** GD-WEEK — read-only Tomorrow and Week views. Fetched when opened, never
 * polled; offline shows the last copy "as of HH:MM". No Start button. */
export default function PeekScreen({ mode, onBack, deviceToday }: Props) {
  const guess = deviceToday ?? deviceTodayIso();
  return (
    <div className={`screen peek peek--${mode}`} data-testid={`peek-${mode}`}>
      <header className="peek-head">
        <button type="button" className="btn peek-back" onClick={onBack}>‹ Today</button>
        <div className="h2">{mode === "tomorrow" ? "Tomorrow" : "Week"}</div>
      </header>
      {mode === "tomorrow" ? <TomorrowView guess={guess} /> : <WeekView guess={guess} />}
    </div>
  );
}

function StaleNote({ result }: { result: FetchPlanRangeResult }) {
  if (result.status !== "ok" || !result.stale) return null;
  return (
    <div className="banner peek-stale" data-testid="peek-stale" role="status">
      Offline — {asOfLabel(result.asOf)}
    </div>
  );
}

function useRange(from: string | null, to: string | null): Load {
  const [load, setLoad] = useState<Load>({ loading: true });
  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    setLoad({ loading: true });
    void fetchPlanRange(from, to).then((result) => {
      if (live) setLoad({ loading: false, result });
    });
    return () => {
      live = false;
    };
  }, [from, to]);
  return load;
}

function TomorrowView({ guess }: { guess: string }) {
  // One day either side of the device's guess, so an active-timezone
  // difference can't miss the day. The API's `today` decides.
  const load = useRange(addDays(guess, -1), addDays(guess, 2));
  if (load.loading) return <div className="peek-body muted">Loading…</div>;
  const r = load.result;
  if (r.status === "error") {
    return <div className="peek-body muted" data-testid="peek-error">Couldn't load tomorrow ({r.message}).</div>;
  }
  const day = tomorrowOf(r.data);
  return (
    <div className="peek-body">
      <StaleNote result={r} />
      {day ? (
        <PlanDayDetail day={day} today={r.data.today} />
      ) : (
        <div className="muted" data-testid="peek-empty">Nothing planned for tomorrow.</div>
      )}
    </div>
  );
}

function WeekView({ guess }: { guess: string }) {
  const [start, setStart] = useState(() => programWeekStart(guess));
  const [anchored, setAnchored] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const load = useRange(start, addDays(start, 6));

  // Re-anchor once on the API's `today` (active timezone) if the device's
  // guess put us in the wrong program week.
  useEffect(() => {
    if (anchored || load.loading || load.result.status !== "ok") return;
    setAnchored(true);
    const real = programWeekStart(load.result.data.today);
    if (real !== start) setStart(real);
  }, [anchored, load, start]);

  const move = (dir: -1 | 1) => {
    setAnchored(true);
    setSelected(null);
    setStart((s) => shiftWeek(s, dir));
  };

  const result = load.loading ? null : load.result;
  const data = result?.status === "ok" ? result.data : null;
  const byDate = new Map<string, PlanDay>((data?.days ?? []).map((d) => [d.plan_date, d]));
  const dates = weekDates(start);
  const today = data?.today ?? guess;
  const heading = data ? weekHeading(data.days) : null;
  const pick = selected ?? (dates.includes(today) ? today : dates.find((d) => byDate.has(d)) ?? null);
  const detail = pick ? byDate.get(pick) ?? null : null;

  return (
    <div className="peek-body peek-week">
      <div className="week-nav">
        <button type="button" className="btn week-arrow" aria-label="Previous week" onClick={() => move(-1)}>‹</button>
        <div className="week-title" data-testid="week-title">
          <div className="h3">{heading ?? (load.loading ? "Loading…" : "No plan this week")}</div>
          <div className="meta">{dayLabel(dates[0])} – {dayLabel(dates[6])}</div>
        </div>
        <button type="button" className="btn week-arrow" aria-label="Next week" onClick={() => move(1)}>›</button>
      </div>
      {result && <StaleNote result={result} />}
      {result?.status === "error" && (
        <div className="muted" data-testid="peek-error">Couldn't load this week ({result.message}).</div>
      )}

      <div className="week-grid">
        <ol className="week-list" data-testid="week-list">
          {dates.map((d) => {
            const day = byDate.get(d);
            const st = day ? statusIcon(day.status) : null;
            const mins = day ? totalMinutes(day) : null;
            const cls = ["week-row", d === today ? "week-row--today" : "", d === pick ? "week-row--selected" : "",
                         day ? `week-row--${day.status}` : "week-row--empty"].filter(Boolean).join(" ");
            return (
              <li key={d}>
                <button
                  type="button"
                  className={cls}
                  data-testid={`week-row-${d}`}
                  aria-pressed={d === pick}
                  aria-current={d === today ? "date" : undefined}
                  disabled={!day}
                  onClick={() => setSelected(d)}
                >
                  <span className="week-day">{dayLabel(d)}</span>
                  <span className="week-session">
                    {day ? sessionName(day) : "—"}
                    {day?.adjusted && <span className="badge badge--adjusted">Adjusted</span>}
                  </span>
                  <span className="week-mins mono">{mins != null ? `${mins} min` : ""}</span>
                  <span className={`week-status ds--${day?.status ?? "none"}`} aria-label={st?.label} title={st?.label}>
                    {st?.icon ?? ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="week-detail">
          {detail ? <PlanDayDetail day={detail} today={today} /> : null}
        </div>
      </div>
    </div>
  );
}
