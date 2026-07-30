import { apiError, spotifyJson } from "@/lib/spotify";
import {
  normalizeSpotifyTrack,
  normalizeSpotifyUserReference,
  type NormalizedSpotifyTrack,
  type NormalizedSpotifyUserReference,
} from "@/lib/spotify-data";

export const dynamic = "force-dynamic";

type SpotifyItem = {
  added_at?: unknown;
  added_by?: unknown;
  is_local?: unknown;
  item?: unknown;
  track?: unknown;
};
type ItemPage = { items?: Array<SpotifyItem | null> | null; next?: unknown };

type NormalizedPlaylistItem = {
  added_at: string | null;
  added_by?: NormalizedSpotifyUserReference | null;
  is_local: boolean;
  item: NormalizedSpotifyTrack;
  originalIndex: number;
  key: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const output: NormalizedPlaylistItem[] = [];
    let next: string | null = `/playlists/${encodeURIComponent(id)}/items?limit=50`;
    const visitedPages = new Set<string>();
    let index = 0;
    while (next && !visitedPages.has(next)) {
      visitedPages.add(next);
      const page: ItemPage = await spotifyJson<ItemPage>(next);
      const entries = Array.isArray(page.items) ? page.items : [];
      for (const rawEntry of entries) {
        const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
        const item = normalizeSpotifyTrack(entry.item ?? entry.track, index);
        const addedBy = normalizeSpotifyUserReference(entry.added_by);
        const addedAt = nonEmptyString(entry.added_at) ?? null;
        output.push({
          added_at: addedAt,
          ...(entry.added_by === null
            ? { added_by: null }
            : addedBy
              ? { added_by: addedBy }
              : {}),
          is_local: entry.is_local === true,
          item,
          originalIndex: index,
          key: `${index}:${item.uri}:${addedAt ?? "unknown"}`,
        });
        index += 1;
      }
      next = nonEmptyString(page.next) ?? null;
    }
    return Response.json({ items: output });
  } catch (error) {
    return apiError(error);
  }
}
