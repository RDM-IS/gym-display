import type { GridColumn, GridCell, RecCell } from "../lib/status3";
import { shortDow } from "../lib/status3";
import { md } from "../lib/overview";
import type { PlanDay } from "../lib/types";

// STATUS-3 — the 7-day grid, the hero of the Status page.
// Columns: yesterday, today (highlighted), the next five. Rows: Morning,
// Evening, Recommended. A divider marks where the grid crosses Sunday into
// Monday, because goal weeks run Monday to Sunday.

interface Props {
  columns: GridColumn[];
  onOpenDay: (row: PlanDay) => void;
  onOpenSessions?: () => void;
}

const ROWS = [
  { key: "morning", label: "Morning" },
  { key: "evening", label: "Evening" },
  { key: "rec", label: "Recommended" },
] as const;

function colClass(c: GridColumn): string {
  return [
    "sg-col",
    c.isToday ? "sg-col--today" : "",
    c.isPast ? "sg-col--past" : "",
    c.weekBreak ? "sg-col--week" : "",
  ].filter(Boolean).join(" ");
}

function Cell({ cell, col, slot, onOpen }: {
  cell: GridCell | null; col: GridColumn; slot: string; onOpen: (r: PlanDay) => void;
}) {
  const id = `sg-${slot}-${col.date}`;
  if (!cell) {
    return <div className={`${colClass(col)} sg-cell sg-cell--empty`} data-testid={id} aria-hidden="true" />;
  }
  return (
    <button
      type="button"
      className={`${colClass(col)} sg-cell sg-tone--${cell.tone}`}
      data-testid={id}
      data-tone={cell.tone}
      aria-label={`${shortDow(col.date)} ${md(col.date)}, ${slot}, ${cell.name}${cell.state ? `, ${cell.state}` : ""}${cell.kcal != null ? `, ${cell.kcal} kcal` : ""}`}
      onClick={() => onOpen(cell.row)}
    >
      <span className="sg-name">{cell.name}</span>
      {(cell.state || cell.kcal != null) && (
        <span className="sg-meta">
          {cell.kcal != null && <span className="sg-kcal">{cell.kcal} kcal</span>}
          {cell.state && cell.kcal == null && <span className="sg-state">{cell.state}</span>}
        </span>
      )}
    </button>
  );
}

function Rec({ rec, col, onOpen, onOpenSessions }: {
  rec: RecCell | null; col: GridColumn; onOpen: (r: PlanDay) => void; onOpenSessions?: () => void;
}) {
  const id = `sg-rec-${col.date}`;
  if (!rec) {
    return <div className={`${colClass(col)} sg-cell sg-cell--empty`} data-testid={id} aria-hidden="true" />;
  }
  const act = col.isToday ? onOpenSessions : rec.row ? () => onOpen(rec.row!) : undefined;
  return (
    <button
      type="button"
      className={`${colClass(col)} sg-cell sg-rec sg-tone--${rec.tone} sg-rec--${rec.kind}`}
      data-testid={id}
      data-tone={rec.tone}
      disabled={!act}
      aria-label={`${shortDow(col.date)} ${md(col.date)}, recommended, ${rec.label}${rec.why ? `, ${rec.why}` : ""}`}
      onClick={act}
    >
      <span className="sg-name">{rec.label}</span>
      {rec.why && <span className="sg-why">{rec.why}</span>}
    </button>
  );
}

export default function StatusGrid({ columns, onOpenDay, onOpenSessions }: Props) {
  return (
    <section className="sg" data-testid="status-grid" aria-label="Next seven days">
      <div className="sg-corner" aria-hidden="true" />
      {columns.map((c) => (
        <div key={c.date} className={`${colClass(c)} sg-head`} data-testid={`sg-head-${c.date}`}
             aria-current={c.isToday ? "date" : undefined}>
          <span className="sg-dow">{c.isToday ? "Today" : shortDow(c.date)}</span>
          <span className="sg-date">{md(c.date)}</span>
        </div>
      ))}
      {ROWS.map((r) => (
        <div key={r.key} className="sg-row" style={{ display: "contents" }}>
          <div className="sg-label">{r.label}</div>
          {columns.map((c) => r.key === "rec"
            ? <Rec key={c.date} rec={c.rec} col={c} onOpen={onOpenDay} onOpenSessions={onOpenSessions} />
            : <Cell key={c.date} cell={r.key === "morning" ? c.morning : c.evening} col={c}
                    slot={r.key} onOpen={onOpenDay} />)}
        </div>
      ))}
    </section>
  );
}
