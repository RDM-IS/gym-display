import type { CardioDetail, NutritionDetail, SectionStatus, SleepRecovery } from "../lib/types";

// STATUS-2 detail sections. Same rule as the tiles: a section that could not be
// read says so and shows nothing, rather than a row of zeros.

function Unreadable({ section, what }: { section: SectionStatus; what: string }) {
  return (
    <div className="muted" data-testid={`${what}-unreadable`}>
      {section.reason ?? `Couldn't read ${what}`}
    </div>
  );
}

function md(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function n(v: number | null | undefined, digits = 0, suffix = ""): string {
  if (v === null || v === undefined) return "—";
  return `${Number.isInteger(v) ? v : v.toFixed(digits)}${suffix}`;
}

export function CardioDetailSection({ detail }: { detail: CardioDetail }) {
  if (!detail.section.ok) return <Unreadable section={detail.section} what="cardio" />;
  const rhr = detail.resting_hr;
  const first = rhr[0]?.value ?? null;
  const last = rhr[rhr.length - 1]?.value ?? null;
  return (
    <div data-testid="cardio-detail">
      {detail.weeks.length === 0 ? (
        <div className="muted" data-testid="cardio-weeks-empty">No cardio logged yet.</div>
      ) : (
        <ul className="st-facts" data-testid="cardio-weeks">
          {detail.weeks.map((w) => (
            <li key={w.week_start}>
              Week of {md(w.week_start)} — <strong>{w.minutes} min</strong>
              <span className="dim"> · {w.sessions} session{w.sessions === 1 ? "" : "s"}</span>
            </li>
          ))}
        </ul>
      )}
      {rhr.length > 0 && (
        // One line, not two: "· 4 readings" wrapped onto its own line and read
        // as a separate fact rather than as the qualifier it is.
        <div className="st-facts st-rhr" data-testid="rhr-trend">
          <span className="st-rhr-line">
            Resting HR {n(first)} → {n(last)} bpm
            <span className="dim">&nbsp;· {rhr.length} readings</span>
          </span>
        </div>
      )}
    </div>
  );
}

export function NutritionDetailSection({ detail }: { detail: NutritionDetail }) {
  if (!detail.section.ok) return <Unreadable section={detail.section} what="nutrition" />;
  const logged = detail.days.filter((d) => d.items > 0);
  if (logged.length === 0) {
    return <div className="muted" data-testid="nutrition-empty">Nothing logged in the last 7 days.</div>;
  }
  return (
    <ul className="st-facts" data-testid="nutrition-7d">
      {detail.days.map((d) => (
        <li key={d.day} className={d.items === 0 ? "dim" : undefined}>
          {md(d.day)} — {d.items === 0 ? "not logged" : (
            <>
              {n(d.kcal)} kcal<span className="dim"> · {n(d.protein_g)} g protein · {n(d.fiber_g)} g fiber</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SleepRecoverySection({ detail }: { detail: SleepRecovery }) {
  if (!detail.section.ok) return <Unreadable section={detail.section} what="sleep and recovery" />;
  const days = detail.days.filter((d) => d.sleep_hrs !== null || d.resting_hr !== null || d.energy !== null);
  if (days.length === 0) {
    return <div className="muted" data-testid="sleep-empty">No sleep or recovery data yet.</div>;
  }
  return (
    <ul className="st-facts" data-testid="sleep-recovery">
      {days.slice(-7).map((d) => (
        <li key={d.day}>
          {md(d.day)} — {n(d.sleep_hrs, 1, " h")} sleep
          <span className="dim">
            {" · "}RHR {n(d.resting_hr)}
            {" · "}energy {n(d.energy)}
          </span>
        </li>
      ))}
    </ul>
  );
}
