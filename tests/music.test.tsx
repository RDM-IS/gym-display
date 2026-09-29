import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MusicPlayer from "../src/components/MusicPlayer";
import { PLAYLISTS, playlistFor } from "../src/lib/music";

// MUSIC-1. The tests that matter are the two about NOT stopping the music: the
// iframe must survive being collapsed, and must survive the flow advancing.

beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* blocked storage */ }
});

describe("which sessions get a player", () => {
  it("offers one for the yoga, core and mobility sessions", () => {
    for (const t of ["recovery_flow", "yoga_strength", "core", "mobility"] as const) {
      expect(playlistFor(t)?.name).toBe("Pure Yoga");
    }
  });

  it("offers none for lifts, cardio or rest", () => {
    for (const t of ["strength_a", "strength_b", "strength_c", "cardio_z2",
                     "cardio_intervals", "walk", "rest", "rest_mobility"] as const) {
      expect(playlistFor(t)).toBeNull();
    }
  });

  it("renders nothing at all when there is no playlist", () => {
    const { container } = render(<MusicPlayer sessionType="strength_a" />);
    expect(container.firstChild).toBeNull();
  });

  it("is null-safe on a missing or unknown session type", () => {
    expect(playlistFor(null)).toBeNull();
    expect(playlistFor(undefined)).toBeNull();
    expect(playlistFor("")).toBeNull();
    expect(playlistFor("something_new")).toBeNull();
  });

  it("uses the approved Pure Yoga playlist id", () => {
    const p = PLAYLISTS.recovery_flow!;
    expect(p.embed).toBe(
      "https://embed.music.apple.com/us/playlist/pure-yoga/pl.6e7eb6c06bcd40ec982e24d6af0cd59a");
    expect(p.web).toBe(
      "https://music.apple.com/us/playlist/pure-yoga/pl.6e7eb6c06bcd40ec982e24d6af0cd59a");
  });
});

describe("collapsed by default, and no iframe until asked", () => {
  it("starts collapsed with no iframe in the tree", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    expect(screen.getByTestId("music-player").dataset.expanded).toBe("0");
    expect(screen.queryByTestId("music-iframe")).toBeNull();
  });

  it("always offers the Open in Apple Music fallback, collapsed or not", () => {
    render(<MusicPlayer sessionType="core" />);
    const link = screen.getByTestId("music-open-link");
    expect(link.getAttribute("href")).toContain("music.apple.com/us/playlist/pure-yoga");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("expands on a tap and mounts the iframe", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    fireEvent.click(screen.getByTestId("music-toggle"));
    expect(screen.getByTestId("music-player").dataset.expanded).toBe("1");
    expect(screen.getByTestId("music-iframe")).toBeTruthy();
  });
});

describe("the iframe survives being collapsed", () => {
  it("keeps the SAME iframe element, hidden, after collapsing", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    fireEvent.click(screen.getByTestId("music-toggle"));
    const first = screen.getByTestId("music-iframe");
    fireEvent.click(screen.getByTestId("music-toggle"));      // collapse

    // Still in the document, and the very same node -- a re-created iframe would
    // reload the embed and stop playback, which is the whole point.
    const after = screen.getByTestId("music-iframe");
    expect(after).toBe(first);
    expect(screen.getByTestId("music-embed").hasAttribute("hidden")).toBe(true);
  });

  it("does not re-create it on the second expand either", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    const toggle = screen.getByTestId("music-toggle");
    fireEvent.click(toggle);
    const first = screen.getByTestId("music-iframe");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByTestId("music-iframe")).toBe(first);
    expect(screen.getByTestId("music-embed").hasAttribute("hidden")).toBe(false);
  });
});

describe("the iframe survives the session advancing", () => {
  it("is the same element after the parent re-renders many times", () => {
    // Stands in for the flow stepping and the workout logging sets: the parent
    // re-renders, the player does not remount.
    function Parent({ step }: { step: number }) {
      return (
        <>
          <div data-testid="step">{step}</div>
          <MusicPlayer sessionType="recovery_flow" />
        </>
      );
    }
    const { rerender } = render(<Parent step={0} />);
    fireEvent.click(screen.getByTestId("music-toggle"));
    const first = screen.getByTestId("music-iframe");
    for (let step = 1; step <= 30; step++) rerender(<Parent step={step} />);
    expect(screen.getByTestId("step").textContent).toBe("30");
    expect(screen.getByTestId("music-iframe")).toBe(first);
  });
});

describe("the iframe attributes are Apple's, exactly", () => {
  it("carries the allow and sandbox values from Apple's snippet", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    fireEvent.click(screen.getByTestId("music-toggle"));
    const f = screen.getByTestId("music-iframe");
    expect(f.getAttribute("allow")).toBe("autoplay *; encrypted-media *;");
    expect(f.getAttribute("sandbox")).toBe(
      "allow-forms allow-popups allow-same-origin allow-scripts " +
      "allow-storage-access-by-user-activation allow-top-navigation-by-user-activation");
    expect(f.getAttribute("src")).toContain("embed.music.apple.com");
  });

  it("says that Play needs one tap, rather than pretending to autoplay", () => {
    render(<MusicPlayer sessionType="recovery_flow" />);
    fireEvent.click(screen.getByTestId("music-toggle"));
    expect(screen.getByTestId("music-note").textContent).toMatch(/one tap/i);
  });
});

describe("the mount points are above the per-step render", () => {
  it("FlowScreen and WorkoutScreen mount it outside their phase trees", async () => {
    // A player placed inside FlowScreen's `phase === "ready"` branch would be
    // torn down on the ready->running transition. Both screens therefore wrap.
    const flow = await import("node:fs").then((fs) =>
      fs.readFileSync("src/screens/FlowScreen.tsx", "utf8"));
    const workout = await import("node:fs").then((fs) =>
      fs.readFileSync("src/screens/WorkoutScreen.tsx", "utf8"));
    for (const [name, src] of [["FlowScreen", flow], ["WorkoutScreen", workout]] as const) {
      expect(src, name).toMatch(/<MusicPlayer sessionType=\{props\.plan\.session_type\} \/>/);
      // Exactly one mount per screen: two would be two iframes.
      expect(src.match(/<MusicPlayer/g)?.length, name).toBe(1);
    }
  });
});
