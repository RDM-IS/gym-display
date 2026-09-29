import { useCallback, useEffect, useState } from "react";
import { fetchPrepSteps, putPrepSteps } from "../lib/api";
import type { PrepStepPayload, PrepStepRecipe, PrepStepsResponse } from "../lib/prep";

/** The recipe steps editor.
 *
 * Steps are the one prep table RDS owns outright — Notion has no step table and is
 * not going to grow one, because steps are the input to a scheduler rather than
 * something to read on a page. So this is where they are edited, and the seed
 * script deliberately leaves a recipe alone once it has any.
 *
 * SAVING REPLACES THE WHOLE LIST. That is simpler than diffing and it has no state
 * in which half a recipe's steps are the new ones. Saving an EMPTY list is a
 * legitimate answer: "this one is cooked fresh, not batch-prepped".
 */
export default function PrepSteps() {
  const [data, setData] = useState<PrepStepsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchPrepSteps();
    if (res.status === "ok") { setData(res.data); setError(null); }
    else setError(res.message);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <div className="prep-body">
        <p className="banner prep-error">{error}</p>
        <button className="btn" onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!data) return <div className="prep-body muted">Loading…</div>;

  return (
    <div className="prep-body">
      <p className="muted">
        {data.with_steps} of {data.with_steps + data.without_steps} recipes have
        steps. A recipe cooked fresh on the day should have none — that is an
        answer, not a gap.
      </p>
      {data.recipes.map((r) => (
        <RecipeSteps
          key={r.recipe_id}
          recipe={r}
          resources={data.resources}
          modes={data.modes}
          isOpen={open === r.recipe_id}
          onToggle={() => setOpen(open === r.recipe_id ? null : r.recipe_id)}
          onSaved={() => void load()}
        />
      ))}
    </div>
  );
}

function RecipeSteps({
  recipe, resources, modes, isOpen, onToggle, onSaved,
}: {
  recipe: PrepStepRecipe;
  resources: string[];
  modes: string[];
  isOpen: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<PrepStepPayload[]>(() => toPayload(recipe));
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => { setRows(toPayload(recipe)); }, [recipe]);

  const save = useCallback(async () => {
    setSaving(true);
    setRefused(null);
    const renumbered = rows.map((r, i) => ({ ...r, step_no: i + 1 }));
    const res = await putPrepSteps(recipe.recipe_id, renumbered);
    setSaving(false);
    if (res.status === "ok") onSaved();
    else setRefused(res.message);
  }, [recipe.recipe_id, rows, onSaved]);

  const update = (i: number, patch: Partial<PrepStepPayload>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section className="prep-store">
      <h3 className="prep-store-name">
        <button className="prep-disclose" onClick={onToggle} aria-expanded={isOpen}>
          {isOpen ? "▾" : "▸"} {recipe.name}
        </button>
        <span className="muted">
          {recipe.steps.length} step{recipe.steps.length === 1 ? "" : "s"}
          {recipe.plan_eligible ? "" : " · never auto-planned"}
        </span>
      </h3>
      {isOpen && (
        <div className="prep-steps-edit">
          {rows.map((r, i) => (
            <div className="prep-step-row" key={i}>
              <input
                aria-label="step name" value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <select
                aria-label="resource" value={r.resource}
                onChange={(e) => update(i, {
                  resource: e.target.value,
                  // An oven step needs a temperature; offer a sane one rather than
                  // letting the save be refused for a field the UI never showed.
                  temp_f: e.target.value === "oven" ? (r.temp_f ?? 425) : r.temp_f,
                })}
              >
                {resources.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <select
                aria-label="mode" value={r.mode}
                onChange={(e) => update(i, { mode: e.target.value })}
              >
                {modes.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <label>base
                <input type="number" min={0} step={0.5} value={r.base_min}
                       onChange={(e) => update(i, { base_min: Number(e.target.value) })} />
              </label>
              <label>/serving
                <input type="number" min={0} step={0.5} value={r.per_serving_min}
                       onChange={(e) => update(i, { per_serving_min: Number(e.target.value) })} />
              </label>
              {r.resource === "oven" && (
                <label>°F
                  <input type="number" min={100} max={600} step={25} value={r.temp_f ?? 425}
                         onChange={(e) => update(i, { temp_f: Number(e.target.value) })} />
                </label>
              )}
              <label>batch
                <input value={r.batch_key ?? ""} placeholder="roast:veg"
                       onChange={(e) => update(i, { batch_key: e.target.value || null })} />
              </label>
              {/* Steps sharing a chain run in order; different chains run in
                  PARALLEL; blank is a barrier that waits for all of them. Leaving
                  it blank throughout gives one queue, which is what it was. */}
              <label>chain
                <input value={r.chain_key ?? ""} placeholder="blank = barrier"
                       onChange={(e) => update(i, { chain_key: e.target.value || null })} />
              </label>
              <button aria-label="remove step"
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div className="prep-steps-actions">
            <button className="btn" onClick={() => setRows((rs) => [...rs, blankStep(rs.length + 1)])}>
              Add step
            </button>
            <button className="btn prep-start" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save steps"}
            </button>
            {refused && <span className="chip chip--no_store">{refused}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function toPayload(recipe: PrepStepRecipe): PrepStepPayload[] {
  return recipe.steps.map((s) => ({
    step_no: s.step_no,
    name: s.name,
    resource: s.resource,
    mode: s.mode,
    base_min: s.base_min ?? 0,
    per_serving_min: s.per_serving_min ?? 0,
    temp_f: s.temp_f,
    batch_key: s.batch_key,
    chain_key: s.chain_key,
    keep_separate: s.keep_separate,
    keep_separate_note: s.keep_separate_note,
    shortcut_key: s.shortcut_key,
    notes: s.notes,
  }));
}

function blankStep(stepNo: number): PrepStepPayload {
  return {
    step_no: stepNo, name: "", resource: "hands", mode: "active",
    base_min: 0, per_serving_min: 0, temp_f: null, batch_key: null, chain_key: null,
    keep_separate: false, keep_separate_note: null, shortcut_key: null, notes: null,
  };
}
