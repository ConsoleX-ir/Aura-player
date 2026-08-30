import { useEffect } from "react";
import { usePlayerStore } from "@/store/playerStore";
import { toast } from "@/store/toastStore";

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

      const s = usePlayerStore.getState();
      if (!s.currentSong) return;

      // Shortcut feedback travels through toasts so the result of an action
      // is unmistakable even when its button is off-screen or already playing
      // a different song's state — e.g. pressing L deep in a scrolled list.
      switch (e.code) {
        // ▶ Play / Pause
        case "Space":
          e.preventDefault();
          s.togglePlay();
          break;

        // ⏭ Next
        case "ArrowRight":
          e.preventDefault();
          if (e.ctrlKey) {
            seekBy(s.progress, s.duration, +5);
          } else {
            s.nextSong();
            announceNowPlaying();
          }
          break;

        // ⏮ Previous
        case "ArrowLeft":
          e.preventDefault();
          if (e.ctrlKey) {
            seekBy(s.progress, s.duration, -5);
          } else {
            s.prevSong();
            announceNowPlaying();
          }
          break;

        // 🔊 Volume ± 5% — the PlayerBar's OSD pill shows the new level,
        // so no toast needed here (two feedback UIs would be redundant).
        case "ArrowUp":
          e.preventDefault();
          s.setVolume(Math.min(s.muted ? s.volume : s.volume + 0.05, 1));
          break;

        case "ArrowDown":
          e.preventDefault();
          s.setVolume(Math.max(s.volume - 0.05, 0));
          break;

        // ❤️ Favorite — with visible confirmation
        case "KeyL": {
          s.toggleFavorite(s.currentSong.id);
          // Re-read once; capture locally so TS knows the song is still there
          // right after the toggle.
          const song = usePlayerStore.getState().currentSong;
          if (!song) break;
          const isFav = usePlayerStore.getState().favorites.includes(song.id);
          toast({
            kind: isFav ? "favorite-add" : "favorite-remove",
            title: isFav ? "Added to Favorites" : "Removed from Favorites",
            subtitle: `${song.title} — ${song.artist}`,
          });
          break;
        }

        // 🔀 Shuffle
        case "KeyS": {
          s.toggleShuffle();
          const on = usePlayerStore.getState().shuffle;
          toast({ kind: on ? "shuffle-on" : "shuffle-off", title: on ? "Shuffle On" : "Shuffle Off" });
          break;
        }

        // 🔁 Repeat
        case "KeyR": {
          s.cycleRepeat();
          const repeat = usePlayerStore.getState().repeat;
          toast({
            kind: repeat === "none" ? "repeat-none" : repeat === "all" ? "repeat-all" : "repeat-one",
            title:
              repeat === "none"
                ? "Repeat Off"
                : repeat === "all"
                  ? "Repeat Queue"
                  : "Repeat This Song",
          });
          break;
        }

        // 🔇 Mute / Unmute
        case "KeyM": {
          s.toggleMute();
          const muted = usePlayerStore.getState().muted;
          toast({
            kind: muted ? "mute" : "unmute",
            title: muted ? "Muted" : "Sound Restored",
            subtitle: muted ? undefined : `${Math.round(usePlayerStore.getState().volume * 100)}% volume`,
          });
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentSongId]);
}

function seekBy(progress: number, duration: number, deltaSeconds: number) {
  const { seekTo } = usePlayerStore.getState();
  if (!duration) return;
  const current = progress * duration;
  const newTime = Math.min(Math.max(current + deltaSeconds, 0), duration);
  seekTo(newTime / duration);
}

// Fires AFTER the store update settles; getState() then holds the song that
// just started — giving arrow-key skips the same "what's playing now?" cue
// mouse users get from watching the player bar change.
function announceNowPlaying() {
  const { currentSong } = usePlayerStore.getState();
  if (!currentSong) return;
  toast({
    kind: "now-playing",
    title: "Now Playing",
    subtitle: `${currentSong.title} — ${currentSong.artist}`,
  });
}
