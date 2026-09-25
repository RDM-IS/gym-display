import { useEffect, useState } from "react";
import BottomBar from "../components/BottomBar";
import PlanDayDetail, { sessionName, totalMinutes } from "../components/PlanDayDetail";
import type { BarTarget } from "../lib/bottom-bar";
import { fetchPlanRange, type FetchPlanRangeResult } from "../lib/api";
import type { PlanDay } from "../lib/types";
import { formatEstimate } from "../lib/format";
import { groupByDate, isRestRow,
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
  /** Bottom-bar navigation (Today / Tomorrow / Week). */
  onNavigate: (target: BarTarget) => void;
  /** Injected in tests; defaults to the device date. */
  deviceToday?: string;
}

type Load = { loading: true } | { loading: false; result: FetchPlanRangeResult };

/** GD-WEEK — read-only Tomorrow and Week views (and a day opened from Week).
 * Fetched when opened, never polled; offline shows the last copy
 * "as of HH:MM". No Start button; the bottom bar is the only navigation. */
export default function PeekScreen({ mode, onNavigate, deviceToday }: Props) {
  const guess = deviceToday ?? deviceTodayIso();
  return mode === "tomorrow"
    ? <TomorrowView guess={guess} onNavigate={onNavigate} />
    : <WeekView guess={guess} onNavigate={onNavigate} />;
}

function PeekFrame({ title, view, testId, onNavigate, children }: {
  title: string;
  view: "tomorrow" | "week" | "day";
  testId: string;
  onNavigate: (target: BarTarget) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`screen peek peek--${view}`} data-testid={testId}>
      <header className="peek-head">
        <div className="h2 peek-title">{title}</div>
      </header>
      {children}
      <BottomBar view={view} onNavigate={onNavigate} />
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

function TomorrowView({ guess, onNavigate }: { guess: string; onNavigate: (t: BarTarget) => void }) {
  // One day either side of the device's guess, so an active-timezone
  // difference can't miss the day. The API's `today` decides.
  const load = useRange(addDays(guess, -1), addDays(guess, 2));
  let body: React.ReactNode;
  if (load.loading) {
    body = <div className="muted">Loading…</div>;
  } else if (load.result.status === "error") {
    body = <div className="muted" data-testid="peek-error">Couldn't load tomorrow ({load.result.message}).</div>;
  } else {
    const r = load.result;
    const day = tomorrowOf(r.data);
    body = (
      <>
        <StaleNote result={r} />
        {day ? (
          <PlanDayDetail day={day} today={r.data.today} />
        ) : (
          <div className="muted" data-testid="peek-empty">Nothing planned for tomorrow.</div>
        )}
      </>
    );
  }
  return (
    <PeekFrame title="Tomorrow" view="tomorrow" testId="peek-tomorrow" onNavigate={onNavigate}>
      <div className="peek-body">{body}</div>
    </PeekFrame>
  );
}

function WeekView({ guess, onNavigate }: { guess: string; onNavigate: (t: BarTarget) => void }) {
  const [start, setStart] = useState(() => programWeekStart(guess));
  const [anchored, setAnchored] = useState(false);
  // A day opened from the list; Week (bottom bar) closes it and keeps `start`.
  const [openDay, setOpenDay] = useState<string | null>(null);
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
    setStart((s) => shiftWeek(s, dir));
  };

  const result = load.loading ? null : load.result;
  const data = result?.status === "ok" ? result.data : null;
  // EVENING-1: a date can carry two rows. The list shows the DATE once, with a
  // sub-line per slot, so "Fri 9/25 Rest" and "Fri 9/25 Recovery Flow" stop
  // reading as duplicates. The API orders morning before evening.
  const rowsByDate = groupByDate(data?.days ?? []);
  //: The row that represents the day in the preview pane: its session if it has
  //: one, else the morning row.
  const byDate = new Map<string, PlanDay>();
  for (const [date, list] of rowsByDate) {
    byDate.set(date, list.find((p) => !isRestRow(p)) ?? list[0]);
  }
  const dates = weekDates(start);
  const today = data?.today ?? guess;
  const heading = data ? weekHeading(data.days) : null;
  // Landscape preview column: today, else the week's first planned day.
  const pick = dates.includes(today) ? today : dates.find((d) => byDate.has(d)) ?? null;
  const detail = pick ? byDate.get(pick) ?? null : null;
  //: openDay is "<date>#<plan_id>" so a day's two slots open their own detail.
  const opened = (() => {
    if (!openDay) return null;
    const [date, pid] = openDay.split("#");
    const rows = rowsByDate.get(date) ?? [];
    return rows.find((p) => String(p.plan_id) === pid) ?? byDate.get(date) ?? null;
  })();

  if (openDay && opened) {
    return (
      <PeekFrame
        title={dayLabel(openDay)}
        view="day"
        testId="peek-day"
        onNavigate={(t) => (t === "week" ? setOpenDay(null) : onNavigate(t))}
      >
        <div className="peek-body">
          {result && <StaleNote result={result} />}
          <PlanDayDetail day={opened} today={today} />
        </div>
      </PeekFrame>
    );
  }

  return (
    <PeekFrame title="Week" view="week" testId="peek-week" onNavigate={onNavigate}>
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
            const rows = rowsByDate.get(d) ?? [];
            const showSlots = rows.length > 1;
            return (
              <li key={d} className={`week-day-group${d === today ? " week-day-group--today" : ""}`}>
                <div className="week-day" aria-current={d === today ? "date" : undefined}>
                  {dayLabel(d)}
                </div>
                {rows.length === 0 ? (
                  <div className="week-row week-row--empty" data-testid={`week-row-${d}`}>
                    <span className="week-session">—</span>
                  </div>
                ) : (
                  rows.map((day) => {
                    const st = statusIcon(day.status);
                    const cls = ["week-row", `week-row--${day.status}`].join(" ");
                    return (
                      <button
                        key={day.plan_id}
                        type="button"
                        className={cls}
                        data-testid={`week-row-${d}${showSlots && day.slot ? `-${day.slot}` : ""}`}
                        onClick={() => setOpenDay(`${d}#${day.plan_id}`)}
                      >
                        {showSlots && day.slot && (
                          <span className="week-slot">{day.slot === "evening" ? "Evening" : "Morning"}</span>
                        )}
                        <span className="week-session">
                          {sessionName(day)}
                          {day.adjusted && <span className="badge badge--adjusted">Adjusted</span>}
                        </span>
                        <span className="week-mins mono">{formatEstimate(totalMinutes(day))}</span>
                        <span className={`week-status ds--${day.status}`} aria-label={st?.label} title={st?.label}>
                          {st?.icon ?? ""}
                        </span>
                      </button>
                    );
                  })
                )}
              </li>
            );
          })}
        </ol>
        <div className="week-detail" aria-hidden={false}>
          {detail ? <PlanDayDetail day={detail} today={today} /> : null}
        </div>
      </div>
    </div>
    </PeekFrame>
  );
}
