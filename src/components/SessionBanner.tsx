import { useEffect, useSyncExternalStore } from "react";
import { isSessionExpired, signInAgain, subscribeSession } from "../lib/session";

/** Full-width banner shown once the Cloudflare Access session has lapsed.
 * Tapping it reloads the page so Access can sign Ryan back in; unsynced sets
 * stay in the offline queue across the reload. */
export default function SessionBanner() {
  const expired = useSyncExternalStore(subscribeSession, isSessionExpired, isSessionExpired);
  // Push nav, badges and screen content below the banner instead of under it.
  useEffect(() => {
    document.documentElement.classList.toggle("session-expired", expired);
    return () => document.documentElement.classList.remove("session-expired");
  }, [expired]);
  if (!expired) return null;
  return (
    <button type="button" className="session-banner" role="alert" onClick={signInAgain}>
      Session expired — tap to sign in
    </button>
  );
}
