import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SetupScreen from "./screens/SetupScreen";
import WorkoutScreen from "./screens/WorkoutScreen";
import DoneScreen from "./screens/DoneScreen";
import ErrorScreen from "./screens/ErrorScreen";
import RestDayScreen from "./screens/RestDayScreen";
import StatusScreen from "./screens/StatusScreen";
import Nav from "./components/Nav";
import {
  fetchLastLogged,
  fetchLoggedToday,
  fetchStatus,
  fetchTodayPlan,
  type FetchStatusResult,
  type FetchTodayResult,
} from "./lib/api";
import { flattenBlocksToSteps } from "./lib/steps";
import { initAudio } from "./lib/audio";
import { shouldRedirectTodayToStatus, usePath } from "./lib/routing";
import type { LastLoggedEntry, Plan } from "./lib/types";
import type {
  ServerLoggedCount,
  SessionSets,
  SetEntry,
} from "./lib/log-state";

type WorkoutFlow = "setup" | "workout" | "done";

const IN_PROGRESS_KEY = "gym_in_progress";

interface PlanLoad {
  loading: boolean;
  result: FetchTodayResult | null;
}

interface StatusLoad {
  loading: boolean;
  result: FetchStatusResult | null;
}

export default function App() {
  const [route, navigate] = usePath();
  const [planLoad, setPlanLoad] = useState<PlanLoad>({ loading: true, result: null });
  const [statusLoad, setStatusLoad] = useState<StatusLoad>({ loading: true, result: null });
  const [flow, setFlow] = useState<WorkoutFlow>("setup");
  const [totalElapsedSec, setTotalElapsedSec] = useState(0);
  const [interrupted, setInterrupted] = useState(
    () =>
      typeof localStorage !== "undefined" &&
      localStorage.getItem(IN_PROGRESS_KEY) === "1"
  );
  const autoRedirectedRef = useRef(false);

  // ── Shared per-set workout state — lifted from WorkoutScreen so it
  //    survives the workout → done transition. DoneScreen uses the same
  //    sessionSets to compute the unlogged-set catch-all with the same
  //    prefill chain (prior set this session → last session → target).
  const [sessionSets, setSessionSets] = useState<SessionSets>({});
  const [serverLoggedCount, setServerLoggedCount] = useState<ServerLoggedCount>({});
  const [lastLogged, setLastLogged] = useState<Record<string, LastLoggedEntry>>({});
  const [logHasSummary, setLogHasSummary] = useState(false);

  const handleLoggedSet = useCallback((exerciseName: string, set: SetEntry) => {
    setSessionSets((prev) => {
      const arr = prev[exerciseName] ?? [];
      return { ...prev, [exerciseName]: [...arr, set] };
    });
  }, []);
  const handleSummaryLogged = useCallback(() => setLogHasSummary(true), []);

  const refreshPlan = useCallback(async () => {
    setPlanLoad({ loading: true, result: null });
    const result = await fetchTodayPlan();
    setPlanLoad({ loading: false, result });
  }, []);

  const refreshStatus = useCallback(async () => {
    setStatusLoad({ loading: true, result: null });
    const result = await fetchStatus();
    setStatusLoad({ loading: false, result });
  }, []);

  useEffect(() => {
    void refreshPlan();
    void refreshStatus();
  }, [refreshPlan, refreshStatus]);

  // Auto-redirect /today → /status when today is rest / missing / already logged.
  // Fires once after status loads. Skipped if user is mid-workout flow.
  useEffect(() => {
    if (autoRedirectedRef.current) return;
    if (route !== "today") return;
    if (flow !== "setup") return;
    if (statusLoad.loading) return;
    if (statusLoad.result?.status !== "ok") return;
    const t = statusLoad.result.data.today_summary;
    if (!t) return;
    // Use blocks.type from the plan payload when available — session_type
    // alone can't distinguish a mobility/walk variant on a shared label.
    const blocks_type =
      planLoad.result?.status === "ok"
        ? planLoad.result.plan.blocks?.type ?? null
        : null;
    if (
      shouldRedirectTodayToStatus({
        exists: t.exists,
        is_skipped: t.is_skipped,
        is_logged: t.is_logged,
        session_type: t.session_type,
        blocks_type,
      })
    ) {
      autoRedirectedRef.current = true;
      navigate("status", { replace: true });
    }
  }, [route, flow, statusLoad, planLoad, navigate]);

  const plan: Plan | null =
    planLoad.result?.status === "ok" ? planLoad.result.plan : null;
  const stepCount = useMemo(
    () => (plan ? flattenBlocksToSteps(plan.blocks).steps.length : 0),
    [plan]
  );

  // Hydrate the shared workout state when a workout starts. Pulls
  // /today/logged for set counts (mid-workout reload safety) and
  // /last_logged for prefill from prior sessions.
  const hydrateWorkoutState = useCallback(async (currentPlan: Plan) => {
    const names: string[] = [];
    const b = currentPlan.blocks;
    if (b?.type === "circuit" && Array.isArray(b.exercises)) {
      for (const e of b.exercises) names.push(e.name);
    }
    const fin = b?.finisher;
    if (fin && Array.isArray(fin.exercises)) {
      for (const e of fin.exercises) names.push(e.name);
    }
    const [loggedR, lastR] = await Promise.all([
      fetchLoggedToday(),
      fetchLastLogged(names),
    ]);
    if (loggedR.status === "ok") {
      const counts: ServerLoggedCount = {};
      for (const e of loggedR.data.exercises) counts[e.exercise] = e.set_count;
      setServerLoggedCount(counts);
      setLogHasSummary(loggedR.data.has_session_summary);
    }
    if (lastR.status === "ok") {
      setLastLogged(lastR.data.by_exercise);
    }
  }, []);

  const onStart = useCallback(() => {
    if (!plan) return;
    initAudio();
    try { localStorage.setItem(IN_PROGRESS_KEY, "1"); } catch { /* ignore */ }
    setInterrupted(false);
    setSessionSets({});         // fresh session — discard any stale entries
    setLogHasSummary(false);
    setFlow("workout");
    void hydrateWorkoutState(plan);
  }, [plan, hydrateWorkoutState]);

  const onDone = useCallback((elapsed_sec: number) => {
    setTotalElapsedSec(elapsed_sec);
    try { localStorage.removeItem(IN_PROGRESS_KEY); } catch { /* ignore */ }
    setFlow("done");
  }, []);

  const onBackToStart = useCallback(() => {
    setFlow("setup");
  }, []);

  const onBackToHome = useCallback(() => {
    try { localStorage.removeItem(IN_PROGRESS_KEY); } catch { /* ignore */ }
    setInterrupted(false);
    setFlow("setup");
  }, []);

  // Render --------------------------------------------------------------

  // The workout screen is full-immersive — never show nav over it.
  const showNav = route === "status" || flow !== "workout";

  // ---- /status route ----
  if (route === "status") {
    if (statusLoad.loading) {
      return (
        <>
          {showNav && <Nav route={route} onNavigate={navigate} />}
          <div className="tv" style={{ justifyContent: "center", alignItems: "center" }}>
            <div className="tv-h2 tv-meta">Loading…</div>
          </div>
        </>
      );
    }
    const sr = statusLoad.result;
    if (!sr || sr.status === "error") {
      return (
        <>
          {showNav && <Nav route={route} onNavigate={navigate} />}
          <ErrorScreen
            title="Status unavailable"
            message={sr?.status === "error" ? sr.message : "Failed to load status."}
            onRetry={refreshStatus}
          />
        </>
      );
    }
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        <StatusScreen data={sr.data} />
      </>
    );
  }

  // ---- /today route (default) ----
  if (planLoad.loading) {
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        <div className="tv" style={{ justifyContent: "center", alignItems: "center" }}>
          <div className="tv-h2 tv-meta">Loading…</div>
        </div>
      </>
    );
  }

  const result = planLoad.result;
  if (!result) return null;

  if (result.status === "no_plan") {
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        <ErrorScreen
          title="No workout today"
          message={`${result.message} Open Status to see this week.`}
          onRetry={refreshPlan}
        />
      </>
    );
  }
  if (result.status === "error") {
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        <ErrorScreen
          title="No plan available"
          message={result.message}
          onRetry={refreshPlan}
        />
      </>
    );
  }

  const offline = result.from_cache;

  // Rest-day classification: session_type alone is unreliable (Sat/Sun may
  // both be cardio_z2 but different workouts). Authoritative signals:
  // is_skipped, session_type='rest_mobility', or blocks.type='mobility'.
  const blocksType = result.plan.blocks?.type;
  const isRestDay =
    result.plan.is_skipped ||
    result.plan.session_type === "rest_mobility" ||
    blocksType === "mobility";

  if (isRestDay) {
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        {offline && <div className="offline-badge">Offline</div>}
        <RestDayScreen plan={result.plan} />
      </>
    );
  }

  if (stepCount === 0) {
    return (
      <>
        {showNav && <Nav route={route} onNavigate={navigate} />}
        <ErrorScreen
          title="Plan has no steps"
          message="Plan loaded but produced no steps. Check the plan in Artemis."
          onRetry={refreshPlan}
        />
      </>
    );
  }

  return (
    <>
      {showNav && <Nav route={route} onNavigate={navigate} />}
      {offline && <div className="offline-badge">Offline</div>}
      {flow === "setup" && (
        <SetupScreen
          plan={result.plan}
          interrupted={interrupted}
          onStart={onStart}
        />
      )}
      {flow === "workout" && (
        <WorkoutScreen
          key={`workout-${result.plan.plan_id}`}
          plan={result.plan}
          sessionSets={sessionSets}
          serverLoggedCount={serverLoggedCount}
          lastLogged={lastLogged}
          hasSummary={logHasSummary}
          onLoggedSet={handleLoggedSet}
          onSummaryLogged={handleSummaryLogged}
          onDone={onDone}
          onBackToHome={onBackToHome}
        />
      )}
      {flow === "done" && (
        <DoneScreen
          plan={result.plan}
          total_elapsed_sec={totalElapsedSec}
          sessionSets={sessionSets}
          serverLoggedCount={serverLoggedCount}
          lastLogged={lastLogged}
          hasSummary={logHasSummary}
          onLoggedSet={handleLoggedSet}
          onSummaryLogged={handleSummaryLogged}
          onBack={onBackToStart}
        />
      )}
    </>
  );
}
