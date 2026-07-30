export function clampPlaybackPosition(position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.min(Math.max(Math.round(position), 0), Math.round(duration));
}

export function playbackProgressPercent(position: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (clampPlaybackPosition(position, duration) / duration) * 100),
  );
}

export function playbackElapsed(
  position: number,
  duration: number,
  paused: boolean,
  observedAt: number,
  clock: number,
) {
  const advanced =
    paused || !Number.isFinite(clock) || !Number.isFinite(observedAt)
      ? position
      : position + Math.max(0, clock - observedAt);
  return clampPlaybackPosition(advanced, duration);
}

export function displayedPlaybackPosition(
  elapsed: number,
  draft: number | null,
  duration: number,
) {
  return clampPlaybackPosition(draft ?? elapsed, duration);
}

export function formatPlaybackTime(milliseconds: number) {
  const totalSeconds = Math.max(
    0,
    Math.floor(Number.isFinite(milliseconds) ? milliseconds / 1000 : 0),
  );
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function isSeekKey(key: string) {
  return [
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
  ].includes(key);
}
