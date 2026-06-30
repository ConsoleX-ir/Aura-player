import { useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";

export function useMediaShortcuts() {
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
  } = usePlayerStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!currentSong) return;

      const target = e.target as HTMLElement;

      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

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
  }, [
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
  ]);
}