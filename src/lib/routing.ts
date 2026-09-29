import { useEffect, useState } from "react";

// ENUM-EXPAND: "prep" goes in the UNION first and the build then names every
// place that has to handle it. A `never` default only narrows over what the union
// declares, so adding the route to a switch without adding it here would compile
// cleanly and throw at runtime — the 2026-09-25 rest-day crash exactly.
export type Route = "today" | "status" | "library" | "prep";

export function pathToRoute(pathname: string): Route {
  const p = pathname.replace(/\/$/, "");
  if (p.endsWith("/status")) return "status";
  if (p.endsWith("/library")) return "library";
  if (p.endsWith("/prep")) return "prep";
  return "today";
}

const ROUTE_PATHS: Record<Route, string> = {
  today: "/today",
  status: "/status",
  library: "/library",
  prep: "/prep",
};

export function routeToPath(route: Route): string {
  // A Record over the union rather than a ternary chain: adding a route to the
  // union now BREAKS THE BUILD here until its path exists, where a chain would
  // have silently sent it to /today.
  return ROUTE_PATHS[route];
}

export function usePath(): [Route, (next: Route, opts?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<Route>(() =>
    typeof window !== "undefined" ? pathToRoute(window.location.pathname) : "today"
  );

  useEffect(() => {
    function onPop() {
      setRoute(pathToRoute(window.location.pathname));
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(next: Route, opts?: { replace?: boolean }) {
    const target = routeToPath(next);
    if (window.location.pathname !== target) {
      if (opts?.replace) {
        window.history.replaceState(null, "", target);
      } else {
        window.history.pushState(null, "", target);
      }
    }
    setRoute(next);
  }

  return [route, navigate];
}

/** Decide whether /today should auto-redirect to /status.
 * Triggers when: rest day (is_skipped, session_type='rest_mobility', or
 * blocks.type='mobility'), missing plan, or today's session is already
 * logged. blocks_type is the authoritative classifier when present —
 * session_type alone is ambiguous (Sat/Sun cardio_z2 share session_type
 * but are different workouts). */
export function shouldRedirectTodayToStatus(t: {
  exists: boolean;
  is_skipped: boolean;
  is_logged: boolean;
  session_type: string | null;
  blocks_type?: string | null;
}): boolean {
  if (!t.exists) return true;
  if (t.is_skipped) return true;
  // YOGA-1: a Recovery Flow is a session to run here, whatever session_type
  // the row carries (9/17 is a rest_mobility row with flow blocks).
  if (t.blocks_type === "recovery_flow" || t.session_type === "recovery_flow") return t.is_logged;
  if (t.blocks_type === "mobility") return true;
  if (t.session_type === "rest_mobility") return true;
  if (t.is_logged) return true;
  return false;
}
