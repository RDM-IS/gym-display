interface Props {
  title: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorScreen({ title, message, onRetry }: Props) {
  return (
    <div className="tv" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div className="tv-h1">{title}</div>
      <div className="tv-h2" style={{ marginTop: "3vh", opacity: 0.85 }}>{message}</div>
      <div className="workout-desc" style={{ marginTop: "3vh" }}>
        Check Mattermost on your phone.
      </div>
      {onRetry && (
        <button
          className="tv-button tv-button--ghost"
          onClick={onRetry}
          style={{ marginTop: "5vh", maxWidth: "50vw" }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
