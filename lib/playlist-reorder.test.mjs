import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlaylistRangeMove,
  isPlaylistOrder,
  planPlaylistReorderBatch,
} from "./playlist-reorder.ts";

test("validates playlist orders as zero-based permutations", () => {
  assert.equal(isPlaylistOrder([2, 0, 1]), true);
  assert.equal(isPlaylistOrder([2, 0, 0]), false);
  assert.equal(isPlaylistOrder([3, 0, 1]), false);
  assert.equal(isPlaylistOrder([2, 0, 1], 4), false);
});

test("groups a contiguous desired range into one Spotify move", () => {
  const batch = planPlaylistReorderBatch(
    [3, 4, 5, 0, 1, 2],
    [0, 1, 2, 3, 4, 5],
    20,
  );

  assert.deepEqual(batch.moves, [
    { rangeStart: 3, insertBefore: 0, rangeLength: 3 },
  ]);
  assert.deepEqual(batch.currentOrder, [3, 4, 5, 0, 1, 2]);
  assert.equal(batch.settled, 6);
  assert.equal(batch.complete, true);
});

test("caps a large random-style reorder to the requested batch size", () => {
  const length = 1_005;
  const current = Array.from({ length }, (_, index) => index);
  const desired = [...current].reverse();
  const batch = planPlaylistReorderBatch(desired, current, 20);

  assert.equal(batch.moves.length, 20);
  assert.equal(batch.settled, 20);
  assert.equal(batch.complete, false);
});

test("successive bounded batches reproduce the exact desired order", () => {
  const desired = [8, 2, 10, 0, 6, 4, 11, 1, 9, 5, 3, 7];
  let current = Array.from({ length: desired.length }, (_, index) => index);
  let batches = 0;

  while (current.some((entry, index) => entry !== desired[index])) {
    const batch = planPlaylistReorderBatch(desired, current, 3);
    assert.ok(batch.moves.length > 0);

    const applied = batch.moves.reduce(
      (order, move) => applyPlaylistRangeMove(order, move),
      current,
    );
    assert.deepEqual(applied, batch.currentOrder);
    current = batch.currentOrder;
    batches += 1;
    assert.ok(batches <= desired.length);
  }

  assert.deepEqual(current, desired);
});
