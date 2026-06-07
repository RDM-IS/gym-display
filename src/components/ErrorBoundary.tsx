import { Component, type ReactNode, type ErrorInfo } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Top-level error boundary. Catches runtime crashes inside any descendant
 * (e.g. an unguarded .length on a future payload-shape change) and shows
 * a readable fallback with a route back to /status, instead of a blank
 * page from React's default unmount behavior. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console-log for the deploy preview / production console; no remote
    // logger is wired up for this app yet.
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  private handleReload = () => {
    this.setState({ error: null });
    if (typeof window !== "undefined") window.location.assign("/status");
  };

  private handleReset = () => {
    this.setState({ error: null });
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    if (this.state.error) {
      const msg = this.state.error.message || "Something broke.";
      return (
        <div
          className="tv"
          style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}
        >
          <div className="tv-h1">Something broke</div>
          <div className="tv-h2" style={{ marginTop: "3vh", opacity: 0.85 }}>
            {msg}
          </div>
          <div className="workout-desc" style={{ marginTop: "3vh" }}>
            Open the Status page or refresh.
          </div>
          <div style={{ display: "flex", gap: "2vw", marginTop: "5vh" }}>
            <button
              className="tv-button tv-button--ghost"
              onClick={this.handleReload}
              style={{ maxWidth: "30vw" }}
            >
              Go to Status
            </button>
            <button
              className="tv-button tv-button--ghost"
              onClick={this.handleReset}
              style={{ maxWidth: "30vw" }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
