interface Props {
  title: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorScreen({ title, message, onRetry }: Props) {
  if (message === "session_expired") {
    // The banner owns the fix; don't show a raw code or a dead-end Retry.
    return (
      <div className="screen screen--center">
        <div className="h1">Signed out</div>
        <div className="h2 dim">Tap the red banner to sign back in.</div>
        <div className="desc">Any sets waiting to sync are kept and will send after sign-in.</div>
      </div>
    );
  }
  return (
    <div className="screen screen--center">
      <div className="h1">{title}</div>
      <div className="h2 dim">{message}</div>
      <div className="desc">Check Mattermost on your phone.</div>
      {onRetry && (
        <button type="button" className="btn btn--ghost btn--wide" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
