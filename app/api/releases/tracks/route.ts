import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type TrackArtist = {
  id?: unknown;
  name?: unknown;
};
type AlbumTrack = {
  id?: unknown;
  name?: unknown;
  uri?: unknown;
  artists?: TrackArtist[] | null;
  disc_number?: unknown;
  track_number?: unknown;
  is_playable?: unknown;
};
type TrackPage = {
  items?: Array<AlbumTrack | null> | null;
  next?: unknown;
};
type ReleaseTracksBody = {
  ids?: unknown;
};

const SPOTIFY_ID = /^[a-zA-Z0-9]{22}$/;
const TRACK_URI = /^spotify:track:[a-zA-Z0-9]{22}$/;
const MAX_RELEASES = 20;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
    ? Math.floor(value)
    : undefined;
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      (origin && new URL(origin).origin !== new URL(request.url).origin) ||
      (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
    ) {
      return Response.json(
        { error: "Cross-origin release requests are not allowed." },
        { status: 403 },
      );
    }

    let body: ReleaseTracksBody;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json(
          { error: "A valid release selection is required." },
          { status: 400 },
        );
      }
      body = parsed as ReleaseTracksBody;
    } catch {
      return Response.json(
        { error: "A valid release selection is required." },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.ids)) {
      return Response.json(
        { error: "Choose at least one release." },
        { status: 400 },
      );
    }
    const ids = Array.from(new Set(body.ids));
    if (
      ids.length === 0 ||
      ids.length > MAX_RELEASES ||
      ids.some((id) => typeof id !== "string" || !SPOTIFY_ID.test(id))
    ) {
      return Response.json(
        { error: `Choose between 1 and ${MAX_RELEASES} valid releases.` },
        { status: 400 },
      );
    }

    const tracks: Array<{
      id: string;
      uri: string;
      name: string;
      artists: Array<{ id?: string; name: string }>;
      albumId: string;
      albumUri: string;
      discNumber?: number;
      trackNumber?: number;
    }> = [];
    const seenUris = new Set<string>();

    for (const rawId of ids) {
      const albumId = rawId as string;
      let next: string | null =
        `/albums/${encodeURIComponent(albumId)}/tracks?limit=50`;
      const visitedPages = new Set<string>();
      while (next && !visitedPages.has(next)) {
        visitedPages.add(next);
        const page = await spotifyJson<TrackPage>(next, {
          signal: request.signal,
        });
        for (const rawTrack of Array.isArray(page.items) ? page.items : []) {
          if (!rawTrack || rawTrack.is_playable === false) continue;
          const id = nonEmptyString(rawTrack.id);
          const uri = nonEmptyString(rawTrack.uri);
          if (!id || !uri || !TRACK_URI.test(uri) || seenUris.has(uri)) continue;
          seenUris.add(uri);
          tracks.push({
            id,
            uri,
            name: nonEmptyString(rawTrack.name) ?? "Unavailable track",
            artists: (Array.isArray(rawTrack.artists) ? rawTrack.artists : [])
              .flatMap((artist) => {
                const name = nonEmptyString(artist?.name);
                if (!name) return [];
                const artistId = nonEmptyString(artist?.id);
                return [{ ...(artistId ? { id: artistId } : {}), name }];
              }),
            albumId,
            albumUri: `spotify:album:${albumId}`,
            ...(finiteInteger(rawTrack.disc_number) !== undefined
              ? { discNumber: finiteInteger(rawTrack.disc_number) }
              : {}),
            ...(finiteInteger(rawTrack.track_number) !== undefined
              ? { trackNumber: finiteInteger(rawTrack.track_number) }
              : {}),
          });
        }
        next = nonEmptyString(page.next) ?? null;
      }
    }

    return Response.json({ tracks });
  } catch (error) {
    return apiError(error);
  }
}
