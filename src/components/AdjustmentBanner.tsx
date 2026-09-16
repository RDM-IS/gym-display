import { useState } from "react";
import { adjustmentHeadline } from "../lib/adjustment";
import type { PlanAdjustment } from "../lib/types";

/** "Adjusted: shoulder 4/5 — tap for details". Expands to what the morning
 * check-in removed, added and eased — Artemis's own plan-exact summary. */
export default function AdjustmentBanner({ adjustment }: { adjustment: PlanAdjustment }) {
  const [open, setOpen] = useState(false);
  const removed = adjustment.removed ?? [];
  const added = adjustment.added ?? [];
  const eased = adjustment.eased ?? [];
  const summary = adjustment.summary ?? [];
  return (
    <div className="adjust-banner" data-testid="adjustment-banner">
      <button
        type="button"
        className="adjust-banner-head"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Adjusted: {adjustmentHeadline(adjustment)} — {open ? "tap to hide" : "tap for details"}
      </button>
      {open && (
        <div className="adjust-banner-body">
          {summary.length > 0 && (
            <ul className="list">
              {summary.map((s) => <li key={s}>{s}</li>)}
            </ul>
          )}
          {removed.length > 0 && <div><strong>Removed:</strong> {removed.join(", ")}</div>}
          {added.length > 0 && <div><strong>Added:</strong> {added.join(", ")}</div>}
          {eased.length > 0 && <div><strong>Eased:</strong> {eased.join(", ")}</div>}
          <div className="muted">Reply <code>original</code> to @artemis to undo.</div>
        </div>
      )}
    </div>
  );
}
