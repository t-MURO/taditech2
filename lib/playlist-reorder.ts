export type PlaylistRangeMove = {
  rangeStart: number;
  insertBefore: number;
  rangeLength: number;
};

export type PlaylistReorderBatch = {
  moves: PlaylistRangeMove[];
  currentOrder: number[];
  settled: number;
  complete: boolean;
};

export function isPlaylistOrder(
  value: unknown,
  expectedLength?: number,
): value is number[] {
  if (!Array.isArray(value)) return false;
  const length = expectedLength ?? value.length;
  if (value.length !== length) return false;

  const seen = new Set<number>();
  for (const entry of value) {
    if (
      !Number.isInteger(entry) ||
      entry < 0 ||
      entry >= length ||
      seen.has(entry)
    ) {
      return false;
    }
    seen.add(entry);
  }
  return true;
}

export function applyPlaylistRangeMove(
  order: readonly number[],
  move: PlaylistRangeMove,
) {
  const next = [...order];
  const range = next.splice(move.rangeStart, move.rangeLength);
  next.splice(move.insertBefore, 0, ...range);
  return next;
}

export function planPlaylistReorderBatch(
  desiredOrder: readonly number[],
  currentOrder: readonly number[],
  maxMoves: number,
): PlaylistReorderBatch {
  if (
    !isPlaylistOrder(desiredOrder) ||
    !isPlaylistOrder(currentOrder, desiredOrder.length)
  ) {
    throw new TypeError("Playlist orders must be matching permutations.");
  }
  if (!Number.isInteger(maxMoves) || maxMoves < 1) {
    throw new TypeError("A playlist reorder batch must allow at least one move.");
  }

  let next = [...currentOrder];
  const moves: PlaylistRangeMove[] = [];
  let target = 0;

  while (target < desiredOrder.length && moves.length < maxMoves) {
    if (next[target] === desiredOrder[target]) {
      target += 1;
      continue;
    }

    const source = next.indexOf(desiredOrder[target], target + 1);
    if (source === -1) {
      throw new TypeError("The current and desired playlist orders do not match.");
    }

    let rangeLength = 1;
    while (
      target + rangeLength < desiredOrder.length &&
      source + rangeLength < next.length &&
      next[source + rangeLength] === desiredOrder[target + rangeLength]
    ) {
      rangeLength += 1;
    }

    const move = {
      rangeStart: source,
      insertBefore: target,
      rangeLength,
    };
    moves.push(move);
    next = applyPlaylistRangeMove(next, move);
    target += rangeLength;
  }

  let settled = 0;
  while (
    settled < desiredOrder.length &&
    next[settled] === desiredOrder[settled]
  ) {
    settled += 1;
  }

  return {
    moves,
    currentOrder: next,
    settled,
    complete: settled === desiredOrder.length,
  };
}
