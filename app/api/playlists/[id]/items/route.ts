import {
  apiError,
  hasPlaylistModifyScopes,
  spotifyJson,
  SpotifyError,
} from "@/lib/spotify";
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
type AddItemBody = { uri?: string };
type AddItemResponse = { snapshot_id?: unknown };

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

const PLAYLIST_ID = /^[a-zA-Z0-9]{22}$/;
const TRACK_URI = /^spotify:track:[a-zA-Z0-9]{22}$/;

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

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      (origin && new URL(origin).origin !== new URL(request.url).origin) ||
      (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
    ) {
      return Response.json(
        { error: "Cross-origin playlist requests are not allowed." },
        { status: 403 },
      );
    }
    if (!(await hasPlaylistModifyScopes())) {
      throw new SpotifyError(
        "Reconnect Spotify to grant playlist editing permission.",
        403,
        undefined,
        "reauthorize",
      );
    }

    const { id } = await context.params;
    if (!PLAYLIST_ID.test(id)) {
      return Response.json({ error: "This playlist is invalid." }, { status: 400 });
    }

    let body: AddItemBody;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json(
          { error: "A valid playlist item is required." },
          { status: 400 },
        );
      }
      body = parsed as AddItemBody;
    } catch {
      return Response.json(
        { error: "A valid playlist item is required." },
        { status: 400 },
      );
    }
    if (!body.uri || !TRACK_URI.test(body.uri)) {
      return Response.json(
        { error: "This Spotify track is invalid." },
        { status: 400 },
      );
    }

    const result = await spotifyJson<AddItemResponse>(
      `/playlists/${encodeURIComponent(id)}/items`,
      {
        method: "POST",
        body: JSON.stringify({ uris: [body.uri] }),
        signal: request.signal,
      },
    );
    const snapshotId = nonEmptyString(result.snapshot_id);
    if (!snapshotId) {
      throw new SpotifyError(
        "Spotify added the track but returned an invalid playlist snapshot.",
        502,
      );
    }
    return Response.json({ snapshotId }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
