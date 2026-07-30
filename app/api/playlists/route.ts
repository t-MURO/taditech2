import { apiError, spotifyJson } from "@/lib/spotify";
import { normalizeSpotifyImages } from "@/lib/spotify-data";

export const dynamic = "force-dynamic";

type Playlist = {
  id?: unknown;
  name?: unknown;
  collaborative?: unknown;
  description?: unknown;
  public?: unknown;
  snapshot_id?: unknown;
  images?: unknown;
  external_urls?: unknown;
  owner?: { id?: unknown; display_name?: unknown } | null;
  items?: { total?: unknown } | null;
  tracks?: { total?: unknown } | null;
};
type PlaylistPage = { items?: Playlist[] | null; next?: unknown };
type Profile = { id?: unknown };

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function itemCount(playlist: Playlist): number {
  const value = playlist.items?.total ?? playlist.tracks?.total;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

export async function GET() {
  try {
    const profile = await spotifyJson<Profile>("/me");
    const profileId = nonEmptyString(profile.id);
    if (!profileId) throw new Error("Spotify returned an invalid user profile.");

    const playlists: Playlist[] = [];
    let next: string | null = "/me/playlists?limit=50";
    const visitedPages = new Set<string>();
    while (next && !visitedPages.has(next)) {
      visitedPages.add(next);
      const page: PlaylistPage = await spotifyJson<PlaylistPage>(next);
      playlists.push(...(Array.isArray(page.items) ? page.items : []));
      next = nonEmptyString(page.next) ?? null;
    }

    const editable = playlists
      .flatMap((playlist) => {
        if (!playlist || typeof playlist !== "object") return [];

        const id = nonEmptyString(playlist.id);
        const ownerId = nonEmptyString(playlist.owner?.id);
        const ownerName = nonEmptyString(playlist.owner?.display_name);
        const collaborative = playlist.collaborative === true;
        if (!id || (ownerId !== profileId && !collaborative)) return [];

        const spotifyUrl = nonEmptyString(
          playlist.external_urls
          && typeof playlist.external_urls === "object"
            ? (playlist.external_urls as { spotify?: unknown }).spotify
            : undefined,
        );

        return [{
          id,
          name: nonEmptyString(playlist.name) ?? "Untitled playlist",
          collaborative,
          description: typeof playlist.description === "string"
            ? playlist.description
            : null,
          public: typeof playlist.public === "boolean" ? playlist.public : null,
          snapshot_id: nonEmptyString(playlist.snapshot_id) ?? "",
          images: normalizeSpotifyImages(playlist.images),
          external_urls: {
            spotify: spotifyUrl ?? `https://open.spotify.com/playlist/${encodeURIComponent(id)}`,
          },
          owner: {
            id: ownerId ?? "",
            ...(ownerName ? { display_name: ownerName } : {}),
          },
          itemCount: itemCount(playlist),
        }];
      });

    return Response.json({ playlists: editable });
  } catch (error) {
    return apiError(error);
  }
}
