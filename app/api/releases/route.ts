import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

const RELEASE_BATCH_SIZE = 8;

type Artist = { id: string; name: string };
type ArtistPage = {
  artists: {
    items?: Artist[] | null;
    next?: string | null;
    total?: number;
    cursors?: { after?: string | null };
  };
};
type Album = {
  id: string;
  name: string;
  album_type: "album" | "single" | "compilation";
  release_date: string;
  release_date_precision: string;
  total_tracks: number;
  images: Array<{ url: string; width: number; height: number }>;
  artists: Array<{ id: string; name: string; external_urls?: { spotify: string } }>;
  external_urls: { spotify: string };
};
type AlbumPage = { items?: Album[] | null };

function cursorFrom(page: ArtistPage["artists"]) {
  if (!page.next) return null;
  if (page.cursors?.after) return page.cursors.after;
  try {
    return new URL(page.next).searchParams.get("after");
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const requestedCursor = new URL(request.url).searchParams.get("after");
    const params = new URLSearchParams({
      type: "artist",
      limit: String(RELEASE_BATCH_SIZE),
    });
    if (requestedCursor) params.set("after", requestedCursor);

    const spotifyInit = { signal: request.signal };
    const page = await spotifyJson<ArtistPage>(
      `/me/following?${params}`,
      spotifyInit,
    );
    const artists = (page.artists.items ?? []).filter(
      (artist) => artist && typeof artist.id === "string",
    );
    const albums: Album[] = [];

    // Keep the batch sequential. If Spotify asks us to pause, spotifyJson waits
    // for the full Retry-After window before this loop continues.
    for (const artist of artists) {
      const albumPage = await spotifyJson<AlbumPage>(
        `/artists/${encodeURIComponent(artist.id)}/albums?include_groups=album,single&limit=8`,
        spotifyInit,
      );
      albums.push(...(albumPage.items ?? []));
    }

    const unique = Array.from(new Map(albums.map((album) => [album.id, album])).values())
      .sort((a, b) => b.release_date.localeCompare(a.release_date));
    const nextCursor = cursorFrom(page.artists);

    return Response.json({
      releases: unique,
      artistCount: Math.max(page.artists.total ?? 0, artists.length),
      scannedArtists: artists.length,
      nextCursor,
      complete: !nextCursor,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
