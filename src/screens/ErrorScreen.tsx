interface Props {
  title: string;
  message: string;
  onRetry?: () => void;
}

export default function ErrorScreen({ title, message, onRetry }: Props) {
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
