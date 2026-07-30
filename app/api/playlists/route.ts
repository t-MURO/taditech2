import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type Playlist = {
  id: string;
  name: string;
  collaborative: boolean;
  description: string | null;
  public: boolean | null;
  snapshot_id: string;
  images: Array<{ url: string }>;
  external_urls: { spotify: string };
  owner: { id: string; display_name?: string };
  items?: { total: number };
  tracks?: { total: number };
};
type PlaylistPage = { items: Playlist[]; next: string | null };
type Profile = { id: string };

export async function GET() {
  try {
    const profile = await spotifyJson<Profile>("/me");
    const playlists: Playlist[] = [];
    let next: string | null = "/me/playlists?limit=50";
    while (next) {
      const page: PlaylistPage = await spotifyJson<PlaylistPage>(next);
      playlists.push(...page.items);
      next = page.next;
    }
    const editable = playlists
      .filter((playlist) => playlist.owner.id === profile.id || playlist.collaborative)
      .map((playlist) => ({
        ...playlist,
        itemCount: playlist.items?.total ?? playlist.tracks?.total ?? 0,
      }));
    return Response.json({ playlists: editable });
  } catch (error) {
    return apiError(error);
  }
}
