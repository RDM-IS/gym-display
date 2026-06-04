import { useEffect, useState } from "react";

export type Route = "today" | "status";

export function pathToRoute(pathname: string): Route {
  return pathname.replace(/\/$/, "").endsWith("/status") ? "status" : "today";
}

export function routeToPath(route: Route): string {
  return route === "status" ? "/status" : "/today";
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
 * Triggers when: rest day (is_skipped or rest_mobility), missing plan,
 * or today's session is already logged. */
export function shouldRedirectTodayToStatus(t: {
  exists: boolean;
  is_skipped: boolean;
  is_logged: boolean;
  session_type: string | null;
}): boolean {
  if (!t.exists) return true;
  if (t.is_skipped) return true;
  if (t.session_type === "rest_mobility") return true;
  if (t.is_logged) return true;
  return false;
}
