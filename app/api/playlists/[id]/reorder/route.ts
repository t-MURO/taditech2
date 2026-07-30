import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type ReorderBody = { order: number[]; snapshotId: string };
type ReorderResponse = { snapshot_id: string };

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as ReorderBody;
    if (
      !Array.isArray(body.order) ||
      !body.order.every((value) => Number.isInteger(value)) ||
      new Set(body.order).size !== body.order.length
    ) {
      return Response.json({ error: "The requested order is invalid." }, { status: 400 });
    }
    const current = Array.from({ length: body.order.length }, (_, index) => index);
    let snapshotId = body.snapshotId;
    let moves = 0;
    for (let target = 0; target < body.order.length; target += 1) {
      const source = current.indexOf(body.order[target]);
      if (source === -1) {
        return Response.json(
          { error: "The playlist changed. Refresh and try again." },
          { status: 409 },
        );
      }
      if (source === target) continue;
      const result = await spotifyJson<ReorderResponse>(
        `/playlists/${encodeURIComponent(id)}/items`,
        {
          method: "PUT",
          body: JSON.stringify({
            range_start: source,
            insert_before: source < target ? target + 1 : target,
            range_length: 1,
            snapshot_id: snapshotId,
          }),
        },
      );
      snapshotId = result.snapshot_id;
      current.splice(target, 0, current.splice(source, 1)[0]);
      moves += 1;
    }
    return Response.json({ snapshotId, moves });
  } catch (error) {
    return apiError(error);
  }
}
