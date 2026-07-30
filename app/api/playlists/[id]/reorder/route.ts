import { apiError, SpotifyError, spotifyJson } from "@/lib/spotify";
import {
  applyPlaylistRangeMove,
  isPlaylistOrder,
  planPlaylistReorderBatch,
} from "@/lib/playlist-reorder";

export const dynamic = "force-dynamic";

const MAX_MOVES_PER_REQUEST = 20;

type ReorderBody = {
  order: number[];
  currentOrder?: number[];
  snapshotId: string;
};
type ReorderResponse = { snapshot_id: string };

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ReorderBody | null;
    if (!body || typeof body !== "object" || !isPlaylistOrder(body.order)) {
      return Response.json({ error: "The requested order is invalid." }, { status: 400 });
    }
    const current = body.currentOrder ??
      Array.from({ length: body.order.length }, (_, index) => index);
    if (!isPlaylistOrder(current, body.order.length)) {
      return Response.json(
        { error: "The current playlist order is invalid. Refresh and try again." },
        { status: 400 },
      );
    }
    if (typeof body.snapshotId !== "string" || !body.snapshotId) {
      return Response.json(
        { error: "The playlist snapshot is missing. Refresh and try again." },
        { status: 400 },
      );
    }

    const batch = planPlaylistReorderBatch(
      body.order,
      current,
      MAX_MOVES_PER_REQUEST,
    );
    let snapshotId = body.snapshotId;
    let appliedOrder = [...current];
    let appliedMoves = 0;
    for (const move of batch.moves) {
      try {
        const result = await spotifyJson<ReorderResponse>(
          `/playlists/${encodeURIComponent(id)}/items`,
          {
            method: "PUT",
            body: JSON.stringify({
              range_start: move.rangeStart,
              insert_before: move.insertBefore,
              range_length: move.rangeLength,
              snapshot_id: snapshotId,
            }),
          },
          {
            maxRateLimitRetries: 0,
            maxServerRetries: 1,
          },
        );
        snapshotId = result.snapshot_id;
        appliedOrder = applyPlaylistRangeMove(appliedOrder, move);
        appliedMoves += 1;
      } catch (error) {
        if (
          error instanceof SpotifyError &&
          error.status === 429 &&
          error.code !== "quota_exceeded" &&
          error.retryAfter !== undefined
        ) {
          let settled = 0;
          while (
            settled < body.order.length &&
            appliedOrder[settled] === body.order[settled]
          ) {
            settled += 1;
          }
          return Response.json({
            snapshotId,
            moves: appliedMoves,
            currentOrder: appliedOrder,
            settled,
            total: body.order.length,
            complete: false,
            paused: true,
            retryAfter: error.retryAfter,
          });
        }
        throw error;
      }
    }
    return Response.json({
      snapshotId,
      moves: appliedMoves,
      currentOrder: appliedOrder,
      settled: batch.settled,
      total: body.order.length,
      complete: batch.complete,
      paused: false,
    });
  } catch (error) {
    return apiError(error);
  }
}
