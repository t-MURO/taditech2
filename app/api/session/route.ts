import { apiError, hasPlaybackScopes, spotifyJson } from "@/lib/spotify";

export const dynamic = "force-dynamic";

type Profile = {
  id: string;
  account_id?: string;
  display_name: string | null;
  images?: Array<{ url: string }>;
  external_urls?: { spotify: string };
};

export async function GET() {
  try {
    const [user, playbackAuthorized] = await Promise.all([
      spotifyJson<Profile>("/me"),
      hasPlaybackScopes(),
    ]);
    return Response.json({ user, playbackAuthorized });
  } catch (error) {
    return apiError(error);
  }
}
