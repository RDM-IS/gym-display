import { formatMMSS } from "../lib/timer";

interface Props {
  total_elapsed_sec: number;
  onBack: () => void;
}

export default function DoneScreen({ total_elapsed_sec, onBack }: Props) {
  return (
    <div className="tv tv--work" style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}>
      <div className="tv-h1">Workout Complete</div>
      <div className="tv-h2 tv-mono" style={{ marginTop: "2vh" }}>
        {formatMMSS(total_elapsed_sec)}
      </div>
      <div className="workout-desc" style={{ marginTop: "3vh" }}>
        Debrief Artemis in Mattermost.
      </div>
      <button
        className="tv-button tv-button--ghost"
        onClick={onBack}
        autoFocus
        style={{ marginTop: "5vh", maxWidth: "60vw" }}
      >
        Back to start
      </button>
    </div>
  );
}
