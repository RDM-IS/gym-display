// ---------------------------------------------------------------------------
// GD-NAV — the one bottom bar on every Setup-level view.
//
//   Today     [Start] … [Tomorrow] [Week]
//   Tomorrow          … [Today] [Week]
//   Week              … [Today] [Tomorrow]
//   Day (from Week)   … [Today] [Week]
//   Status            … [Today] [Tomorrow] [Week]
//
// The right group keeps the order Today → Tomorrow → Week and leaves out the
// view you're on. Start only ever appears on Today.
// ---------------------------------------------------------------------------

export type BarView = "today" | "tomorrow" | "week" | "day" | "status";
export type BarTarget = "today" | "tomorrow" | "week";

export const BAR_ORDER: readonly BarTarget[] = ["today", "tomorrow", "week"];

export const BAR_LABELS: Record<BarTarget, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Week",
};

export function barTargets(view: BarView): BarTarget[] {
  if (view === "day") return ["today", "week"];
  return BAR_ORDER.filter((t) => t !== view);
}

export function barShowsStart(view: BarView): boolean {
  return view === "today";
}
