import { useCallback, useEffect, useMemo, useState } from "react";
import SetupScreen from "./screens/SetupScreen";
import WorkoutScreen from "./screens/WorkoutScreen";
import DoneScreen from "./screens/DoneScreen";
import ErrorScreen from "./screens/ErrorScreen";
import RestDayScreen from "./screens/RestDayScreen";
import { fetchTodayPlan, type FetchTodayResult } from "./lib/api";
import { buildIntervalsForPlan } from "./lib/timer";
import { initAudio } from "./lib/audio";
import type { Plan } from "./lib/types";

type Screen = "setup" | "workout" | "done";

const IN_PROGRESS_KEY = "gym_in_progress";

interface LoadState {
  loading: boolean;
  result: FetchTodayResult | null;
}

export default function App() {
  const [load, setLoad] = useState<LoadState>({ loading: true, result: null });
  const [screen, setScreen] = useState<Screen>("setup");
  const [totalElapsedSec, setTotalElapsedSec] = useState(0);
  const [interrupted, setInterrupted] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(IN_PROGRESS_KEY) === "1"
  );

  const refresh = useCallback(async () => {
    setLoad({ loading: true, result: null });
    const result = await fetchTodayPlan();
    setLoad({ loading: false, result });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const plan: Plan | null = load.result?.status === "ok" ? load.result.plan : null;
  const intervals = useMemo(
    () => (plan ? buildIntervalsForPlan(plan) : []),
    [plan]
  );

  const onStart = useCallback(() => {
    if (!plan) return;
    initAudio();
    try { localStorage.setItem(IN_PROGRESS_KEY, "1"); } catch { /* ignore */ }
    setInterrupted(false);
    setScreen("workout");
  }, [plan]);

  const onDone = useCallback((elapsed_sec: number) => {
    setTotalElapsedSec(elapsed_sec);
    try { localStorage.removeItem(IN_PROGRESS_KEY); } catch { /* ignore */ }
    setScreen("done");
  }, []);

  const onBackToStart = useCallback(() => {
    setScreen("setup");
  }, []);

  if (load.loading) {
    return (
      <div className="tv" style={{ justifyContent: "center", alignItems: "center" }}>
        <div className="tv-h2 tv-meta">Loading…</div>
      </div>
    );
  }

  const result = load.result;
  if (!result) return null;

  if (result.status === "no_plan") {
    return <ErrorScreen title="No plan today" message={result.message} onRetry={refresh} />;
  }
  if (result.status === "error") {
    return (
      <ErrorScreen
        title="No plan available"
        message={result.message}
        onRetry={refresh}
      />
    );
  }

  const offline = result.from_cache;

  if (result.plan.is_skipped || result.plan.session_type === "rest_mobility") {
    return (
      <>
        {offline && <div className="offline-badge">Offline</div>}
        <RestDayScreen plan={result.plan} />
      </>
    );
  }

  if (intervals.length === 0) {
    return (
      <ErrorScreen
        title="Plan has no intervals"
        message="Plan loaded but produced no intervals. Check the plan in Artemis."
        onRetry={refresh}
      />
    );
  }

  return (
    <>
      {offline && <div className="offline-badge">Offline</div>}
      {screen === "setup" && (
        <SetupScreen plan={result.plan} interrupted={interrupted} onStart={onStart} />
      )}
      {screen === "workout" && (
        <WorkoutScreen intervals={intervals} onDone={onDone} />
      )}
      {screen === "done" && (
        <DoneScreen total_elapsed_sec={totalElapsedSec} onBack={onBackToStart} />
      )}
    </>
  );
}
