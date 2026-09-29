import type { SessionType } from "./types";

// MUSIC-1: which playlist a session gets, in ONE map.
//
// A session type that is absent gets NO player at all -- that is the point of
// keying it here rather than "show the player unless...". Lifts and cardio are
// absent deliberately: nothing is chosen for them yet, and a default playlist
// would be Artemis deciding what he listens to while squatting.

export interface Playlist {
  /** Shown on the collapsed bar. */
  readonly name: string;
  /** The embed.music.apple.com URL that goes in the iframe. */
  readonly embed: string;
  /** The plain music.apple.com URL, for the "Open in Apple Music" fallback --
   * which matters when the embed is blocked, or he wants it on the HomePod
   * rather than through the iPad. */
  readonly web: string;
}

const PURE_YOGA: Playlist = {
  name: "Pure Yoga",
  embed: "https://embed.music.apple.com/us/playlist/pure-yoga/pl.6e7eb6c06bcd40ec982e24d6af0cd59a",
  web: "https://music.apple.com/us/playlist/pure-yoga/pl.6e7eb6c06bcd40ec982e24d6af0cd59a",
};

/** Session type → playlist. Absent means no player. */
export const PLAYLISTS: Partial<Record<SessionType, Playlist>> = {
  recovery_flow: PURE_YOGA,
  yoga_strength: PURE_YOGA,
  core: PURE_YOGA,
  mobility: PURE_YOGA,
};

export function playlistFor(sessionType: SessionType | string | null | undefined): Playlist | null {
  if (!sessionType) return null;
  return PLAYLISTS[sessionType as SessionType] ?? null;
}
