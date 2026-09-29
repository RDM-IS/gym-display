import { useEffect, useRef, useState } from "react";
import { playlistFor } from "../lib/music";
import type { SessionType } from "../lib/types";

// MUSIC-1 — a compact, collapsible Apple Music embed.
//
// TWO RULES, and both are about not stopping the music:
//
// 1. ONCE MOUNTED, THE IFRAME IS NEVER UNMOUNTED. Collapsing hides it with CSS.
//    Conditionally rendering it on `expanded` would tear the iframe down and
//    silence playback the first time he collapsed the bar to see a pose -- which
//    is exactly when he would collapse it.
// 2. The component must sit ABOVE the part of the screen that re-renders per
//    step, so advancing the flow cannot remount it. Both mount points wrap their
//    screen rather than living inside a phase branch. `key` is deliberately not
//    set from anything that changes within a session.
//
// Autoplay is not attempted. Browsers block it without a user gesture, and an
// autoplay attempt that silently fails is worse than a Play button: he would
// think the feature is broken rather than that it is waiting for one tap.

const AUTOPLAY_NOTE = "One tap on Play — browsers won't start audio on their own.";

interface Props {
  sessionType: SessionType | string | null | undefined;
  /** Remembered per viewer; a no-op if storage is unavailable. */
  storageKey?: string;
  /** The state before this viewer has ever toggled it. A remembered choice wins.
   * Collapsed by default: the player must not cover a pose on first open. */
  defaultExpanded?: boolean;
}

function readExpanded(key: string, fallback: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export default function MusicPlayer({
  sessionType,
  storageKey = "gd.music.expanded",
  defaultExpanded = false,
}: Props) {
  const playlist = playlistFor(sessionType);
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey, defaultExpanded));
  // Once true, stays true for the life of the component: see rule 1.
  const everExpanded = useRef(expanded);
  if (expanded) everExpanded.current = true;

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, expanded ? "1" : "0");
    } catch {
      /* private window, blocked storage — the player still works. */
    }
  }, [expanded, storageKey]);

  if (!playlist) return null;

  return (
    <section
      className={`music${expanded ? " music--open" : ""}`}
      data-testid="music-player"
      data-expanded={expanded ? "1" : "0"}
      aria-label="Music"
    >
      <div className="music-bar">
        <button
          type="button"
          className="music-toggle"
          data-testid="music-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Music · {playlist.name}
        </button>
        <a
          className="music-open"
          data-testid="music-open-link"
          href={playlist.web}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open in Apple Music
        </a>
      </div>
      {/* Rendered on FIRST expand and kept in the tree from then on. The wrapper
          is what hides it, so playback survives collapsing. */}
      {everExpanded.current && (
        <div className="music-embed" data-testid="music-embed" hidden={!expanded}>
          <iframe
            data-testid="music-iframe"
            title={`Apple Music — ${playlist.name}`}
            src={playlist.embed}
            height="150"
            style={{ width: "100%", maxWidth: "660px", overflow: "hidden", borderRadius: "10px" }}
            frameBorder="0"
            allow="autoplay *; encrypted-media *;"
            sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
          />
          <div className="music-note dim" data-testid="music-note">{AUTOPLAY_NOTE}</div>
        </div>
      )}
    </section>
  );
}
