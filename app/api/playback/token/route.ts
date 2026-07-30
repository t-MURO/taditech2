import { apiError, getAccessToken, hasPlaybackScopes, SpotifyError } from "@/lib/spotify";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      (origin && new URL(origin).origin !== new URL(request.url).origin) ||
      (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
    ) {
      return Response.json(
        { error: "Cross-origin playback token requests are not allowed." },
        { status: 403, headers: noStoreHeaders() },
      );
    }
    if (!(await hasPlaybackScopes())) {
      throw new SpotifyError(
        "Reconnect Spotify to grant browser playback permission.",
        403,
        undefined,
        "reauthorize",
      );
    }
    const accessToken = await getAccessToken();
    return Response.json(
      { accessToken },
      {
        headers: {
          ...noStoreHeaders(),
        },
      },
    );
  } catch (error) {
    const response = apiError(error);
    for (const [name, value] of Object.entries(noStoreHeaders())) {
      response.headers.set(name, value);
    }
    return response;
  }
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, private",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
  };
}
