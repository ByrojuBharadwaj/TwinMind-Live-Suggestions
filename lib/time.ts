/**
 * Tiny time formatting helpers shared across panels and the eventual export.
 */

/** "0:42" / "12:05" — elapsed mm:ss for the recording timer. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** "14:08:30" — wall-clock hh:mm:ss, useful for transcript + export stamps. */
export function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
