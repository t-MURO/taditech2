import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type Artist = { id: string; name: string };
type ArtistPage = {
  artists: { items: Artist[]; next: string | null; total: number };
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
type AlbumPage = { items: Album[] };

async function allFollowedArtists() {
  const artists: Artist[] = [];
  let next: string | null = "/me/following?type=artist&limit=50";
  while (next) {
    const page: ArtistPage = await spotifyJson<ArtistPage>(next);
    artists.push(...page.artists.items);
    next = page.artists.next;
  }
  return artists;
}

export async function GET() {
  try {
    const artists = await allFollowedArtists();
    const albums: Album[] = [];
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(5, Math.max(artists.length, 1)) },
      async () => {
        while (cursor < artists.length) {
          const artist = artists[cursor++];
          const page = await spotifyJson<AlbumPage>(
            `/artists/${artist.id}/albums?include_groups=album,single&limit=8`,
          );
          albums.push(...page.items);
        }
      },
    );
    await Promise.all(workers);
    const unique = Array.from(new Map(albums.map((album) => [album.id, album])).values())
      .sort((a, b) => b.release_date.localeCompare(a.release_date));
    return Response.json({
      releases: unique,
      artistCount: artists.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(error);
  }
}
