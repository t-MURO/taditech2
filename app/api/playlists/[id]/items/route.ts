import { apiError, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type Track = {
  id: string | null;
  uri: string;
  name: string;
  type: string;
  duration_ms?: number;
  explicit?: boolean;
  popularity?: number;
  external_urls?: { spotify: string };
  artists?: Array<{ id: string; name: string; external_urls?: { spotify: string } }>;
  album?: {
    id: string;
    name: string;
    release_date?: string;
    images?: Array<{ url: string }>;
    external_urls?: { spotify: string };
  };
};
type SpotifyItem = {
  added_at: string | null;
  added_by?: { id: string } | null;
  is_local: boolean;
  item?: Track | null;
  track?: Track | null;
};
type ItemPage = { items: SpotifyItem[]; next: string | null; total: number };

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const output: Array<SpotifyItem & { item: Track; originalIndex: number; key: string }> = [];
    let next: string | null = `/playlists/${encodeURIComponent(id)}/items?limit=50`;
    let index = 0;
    while (next) {
      const page: ItemPage = await spotifyJson<ItemPage>(next);
      for (const entry of page.items) {
        const item = entry.item ?? entry.track ?? {
          id: null,
          uri: `spotify:unavailable:${index}`,
          name: "Unavailable item",
          type: "unknown",
        };
        output.push({
          ...entry,
          item,
          originalIndex: index,
          key: `${index}:${item.uri}:${entry.added_at || "unknown"}`,
        });
        index += 1;
      }
      next = page.next;
    }
    return Response.json({ items: output });
  } catch (error) {
    return apiError(error);
  }
}
