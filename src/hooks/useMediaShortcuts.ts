import { useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";

// Only currentSong is subscribed to reactively — it's the one thing that
// decides whether shortcuts should even be active, and it's what the effect
// re-subscribes on. Everything else (progress/duration/volume, and every
// store action) is read fresh via usePlayerStore.getState() at keypress
// time instead of being pulled in as reactive selectors.
//
// This hook renders nothing itself, so the previous version — which called
// usePlayerStore() with no selector at all — bought nothing except forcing
// App (which mounts this hook) to re-render on every single store mutation,
// including the ~4-10Hz progress tick during playback, AND tearing down and
// re-attaching the window keydown listener that same ~4-10 times a second.
export function useMediaShortcuts() {
  const currentSongId = usePlayerStore((s) => s.currentSong?.id);

  useEffect(() => {
    if (!currentSongId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const {
        currentSong,
        progress,
        duration,
        volume,
        togglePlay,
        nextSong,
        prevSong,
        seekTo,
        setVolume,
        toggleFavorite,
        toggleShuffle,
        cycleRepeat,
      } = usePlayerStore.getState();

      if (!currentSong) return;

      switch (e.code) {
        // ▶ Play / Pause
        case "Space":
          e.preventDefault();
          togglePlay();
          break;

        // ⏭ Next
        case "ArrowRight":
          e.preventDefault();

          if (e.ctrlKey) {
            const current = progress * duration;
            seekTo(Math.min(current + 5, duration));
          } else {
            nextSong();
          }
          break;

        // ⏮ Previous
        case "ArrowLeft":
          e.preventDefault();

          if (e.ctrlKey) {
            const current = progress * duration;
            seekTo(Math.max(current - 5, 0));
          } else {
            prevSong();
          }
          break;

        // 🔊 Volume +
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(volume + 0.05, 1));
          break;

        // 🔉 Volume -
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(volume - 0.05, 0));
          break;

        // ❤️ Favorite
        case "KeyL":
          toggleFavorite(currentSong.id);
          break;

        // 🔀 Shuffle
        case "KeyS":
          toggleShuffle();
          break;

        // 🔁 Repeat
        case "KeyR":
          cycleRepeat();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentSongId]);
}
