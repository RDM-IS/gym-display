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
        <div className="screen screen--center">
          <div className="h1">Something broke</div>
          <div className="h2 dim">{msg}</div>
          <div className="desc">Open the Status page or refresh.</div>
          <div className="button-row">
            <button type="button" className="btn btn--ghost btn--wide" onClick={this.handleReload}>
              Go to Status
            </button>
            <button type="button" className="btn btn--ghost btn--wide" onClick={this.handleReset}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
