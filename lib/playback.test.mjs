import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPlaybackPosition,
  displayedPlaybackPosition,
  formatPlaybackTime,
  isSeekKey,
  playbackElapsed,
  playbackProgressPercent,
} from "./playback.ts";

test("clamps seek positions to an integer inside the current item", () => {
  assert.equal(clampPlaybackPosition(-500, 180_000), 0);
  assert.equal(clampPlaybackPosition(60_000.6, 180_000), 60_001);
  assert.equal(clampPlaybackPosition(250_000, 180_000), 180_000);
});

test("rejects invalid seek values and durations", () => {
  assert.equal(clampPlaybackPosition(Number.NaN, 180_000), 0);
  assert.equal(clampPlaybackPosition(30_000, Number.POSITIVE_INFINITY), 0);
  assert.equal(clampPlaybackPosition(30_000, 0), 0);
});

test("keeps rendered progress within zero and one hundred percent", () => {
  assert.equal(playbackProgressPercent(-1, 200_000), 0);
  assert.equal(playbackProgressPercent(50_000, 200_000), 25);
  assert.equal(playbackProgressPercent(250_000, 200_000), 100);
});

test("advances only active playback and never runs beyond its duration", () => {
  assert.equal(playbackElapsed(30_000, 180_000, true, 1_000, 11_000), 30_000);
  assert.equal(playbackElapsed(30_000, 180_000, false, 1_000, 11_000), 40_000);
  assert.equal(playbackElapsed(30_000, 180_000, false, 11_000, 1_000), 30_000);
  assert.equal(playbackElapsed(175_000, 180_000, false, 1_000, 11_000), 180_000);
});

test("uses a zero-valued seek draft instead of the playback clock", () => {
  assert.equal(displayedPlaybackPosition(42_000, 0, 180_000), 0);
  assert.equal(displayedPlaybackPosition(42_000, null, 180_000), 42_000);
});

test("formats playback time and recognizes native range seek keys", () => {
  assert.equal(formatPlaybackTime(0), "0:00");
  assert.equal(formatPlaybackTime(65_999), "1:05");
  assert.equal(formatPlaybackTime(Number.NaN), "0:00");
  assert.equal(isSeekKey("ArrowRight"), true);
  assert.equal(isSeekKey("Home"), true);
  assert.equal(isSeekKey("Enter"), false);
  assert.equal(isSeekKey("Tab"), false);
});
