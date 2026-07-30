import { apiError, spotifyJson } from "@/lib/spotify";

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
    return Response.json({ user: await spotifyJson<Profile>("/me") });
  } catch (error) {
    return apiError(error);
  }
}
