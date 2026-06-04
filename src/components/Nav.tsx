import type { Route } from "../lib/routing";

interface Props {
  route: Route;
  onNavigate: (next: Route) => void;
}

export default function Nav({ route, onNavigate }: Props) {
  function go(e: React.MouseEvent, target: Route) {
    e.preventDefault();
    onNavigate(target);
  }
  return (
    <nav className="app-nav" aria-label="Primary">
      <a
        href="/today"
        className={route === "today" ? "active" : ""}
        onClick={(e) => go(e, "today")}
      >
        Today
      </a>
      <a
        href="/status"
        className={route === "status" ? "active" : ""}
        onClick={(e) => go(e, "status")}
      >
        Status
      </a>
    </nav>
  );
}
