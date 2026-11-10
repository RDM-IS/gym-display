import type { FetchStatusResult } from "./api";
import type { StrengthQuotaStatus } from "./types";

// ---------------------------------------------------------------------------
// SESSION-OPEN 5a — the week counter at the top of the Sessions page.
//
// ONE-READ-ONE-STATUS: the text, the colour and the "counts" tags all come from
// the one `strength_quota` object on /status. The Lambda computes it from
// knowledge/strength_quota.py, so this file decides only how it LOOKS.
//
// Unreadable is never zero: a failed /status, a missing quota (an older
// Lambda), section.ok === false, or any missing number all say so in words.
// ---------------------------------------------------------------------------

export type CounterTone = "loading" | "unreadable" | "met" | "neutral" | "tight" | "short";

export interface CounterView {
  text: string;
  tone: CounterTone;
}

export const UNREADABLE_TEXT = "Couldn't read this week's strength count";

function toneFor(status: StrengthQuotaStatus): CounterTone {
  switch (status) {
    case "met": return "met";
    case "on_track": return "neutral";
    // A week before the counting started: reported, owed nothing — neutral.
    case "not_counted": return "neutral";
    case "tight": return "tight";
    case "short": return "short";
    default: {
      const never: never = status;
      throw new Error(`unknown strength quota status ${String(never)}`);
    }
  }
}

/** `status` is App's one /status read; null while it is loading. */
export function counterView(status: FetchStatusResult | null): CounterView {
  if (status === null) return { text: "Reading this week's strength count…", tone: "loading" };
  if (status.status !== "ok") return { text: UNREADABLE_TEXT, tone: "unreadable" };
  const q = status.data.strength_quota;
  if (!q || !q.section?.ok || q.count == null || q.required == null || q.days_left == null
      || q.status == null) {
    return { text: UNREADABLE_TEXT, tone: "unreadable" };
  }
  const tone = toneFor(q.status);
  if (q.status === "met") return { text: `Strength ${q.count} of ${q.required} — done`, tone };
  const left = q.days_left === 0 ? "no days left"
    : `${q.days_left} day${q.days_left === 1 ? "" : "s"} left`;
  return { text: `Strength ${q.count} of ${q.required} · ${left}`, tone };
}

/** The session types whose day counts toward the quota, as the Lambda serves
 *  them (STRENGTH_DAY_TYPES — never copied here). Empty when /status could not
 *  be read or the Lambda is older: then nothing is tagged, rather than a guess. */
export function countsTypes(status: FetchStatusResult | null): ReadonlySet<string> {
  if (status?.status !== "ok") return new Set();
  return new Set(status.data.strength_quota?.strength_day_types ?? []);
}
