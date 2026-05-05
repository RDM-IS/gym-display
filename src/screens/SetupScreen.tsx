import { useEffect } from "react";
import type { Plan, CircuitBlocks, IntervalsBlocks, WalkBlocks } from "../lib/types";
import { dedupe, formatPlanDate, sessionLabel } from "../lib/format";

interface Props {
  plan: Plan;
  interrupted: boolean;
  onStart: () => void;
}

export default function SetupScreen({ plan, interrupted, onStart }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        onStart();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart]);

  const equipment = dedupe(plan.blocks.equipment);
  const setupNotes = dedupe(
    plan.blocks.type === "walk" ? plan.blocks.setup_notes : plan.blocks.setup_notes
  );

  return (
    <div className="tv">
      <div className="tv-row">
        <div className="tv-meta">{formatPlanDate(plan)}</div>
        <div className="tv-meta">
          Phase {plan.phase} · Week {plan.week_num} · RPE {plan.target_rpe}
        </div>
      </div>

      <div>
        <div className="tv-h1">{sessionLabel(plan)}</div>
        <div className="tv-h2" style={{ opacity: 0.85, marginTop: "1vh" }}>
          ~{plan.est_duration_min} min
        </div>
      </div>

      {interrupted && (
        <div className="banner">
          Workout was interrupted. Start over from the beginning.
        </div>
      )}

      <div className="scroll">
        {equipment.length > 0 && (
          <Section title="Equipment">
            <ul className="tv-list">
              {equipment.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </Section>
        )}

        {setupNotes.length > 0 && (
          <Section title="Setup notes">
            <ul className="tv-list">
              {setupNotes.map((n) => <li key={n}>· {n}</li>)}
            </ul>
          </Section>
        )}

        <BlockDetail blocks={plan.blocks} />
      </div>

      <button className="tv-button" onClick={onStart} autoFocus>
        Start Workout
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "3vh" }}>
      <div className="tv-section-title">{title}</div>
      {children}
    </div>
  );
}

function BlockDetail({ blocks }: { blocks: Plan["blocks"] }) {
  if (blocks.type === "circuit") return <CircuitDetail b={blocks} />;
  if (blocks.type === "intervals") return <IntervalsDetail b={blocks} />;
  return <WalkDetail b={blocks} />;
}

function CircuitDetail({ b }: { b: CircuitBlocks }) {
  return (
    <>
      {b.warmup && (
        <div style={{ marginBottom: "2vh" }}>
          <div className="tv-section-title">Warmup</div>
          <div className="tv-list">{b.warmup}</div>
        </div>
      )}
      <div className="tv-section-title">
        Exercises — {b.rounds} round{b.rounds === 1 ? "" : "s"}
      </div>
      <ul className="tv-list">
        {b.exercises.map((ex, i) => (
          <li key={`${ex.name}-${i}`}>
            <strong>{ex.name}</strong>
            {" — "}
            {ex.format === "reps"
              ? `${ex.target_reps ?? "?"} reps`
              : `${ex.duration_sec ?? "?"} sec`}
            {ex.target_load_lbs != null && ex.format === "reps" ? ` @ ~${ex.target_load_lbs} lb` : ""}
          </li>
        ))}
      </ul>
      {b.cooldown && (
        <div style={{ marginTop: "2vh" }}>
          <div className="tv-section-title">Cooldown</div>
          <div className="tv-list">{b.cooldown}</div>
        </div>
      )}
    </>
  );
}

function IntervalsDetail({ b }: { b: IntervalsBlocks }) {
  const t = b.intervals_template;
  return (
    <>
      {b.warmup_sec > 0 && (
        <div style={{ marginBottom: "2vh" }}>
          <div className="tv-section-title">Warmup — {Math.round(b.warmup_sec / 60)} min</div>
          <div className="tv-list">{b.warmup_settings ?? ""}</div>
        </div>
      )}
      <div className="tv-section-title">Intervals — {b.rounds} rounds</div>
      <ul className="tv-list">
        <li>Work {t.work_sec}s — {t.work_settings ?? ""}</li>
        <li>Rest {t.rest_sec}s — {t.rest_settings ?? ""}</li>
      </ul>
      {b.cooldown_sec > 0 && (
        <div style={{ marginTop: "2vh" }}>
          <div className="tv-section-title">Cooldown — {Math.round(b.cooldown_sec / 60)} min</div>
        </div>
      )}
    </>
  );
}

function WalkDetail({ b }: { b: WalkBlocks }) {
  return (
    <div className="tv-list">
      {b.duration_min} min · {b.intensity ?? "easy"}
    </div>
  );
}
