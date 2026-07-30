import {
  apiError,
  hasPlaybackScopes,
  spotifyFetch,
  SpotifyError,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

type PlaybackRequest = {
  deviceId?: string;
  contextUri?: string;
  offsetUri?: string;
  uris?: string[];
};

const DEVICE_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TRACK_URI = /^spotify:track:[a-zA-Z0-9]{22}$/;
const CONTEXT_URI = /^spotify:(album|artist|playlist):[a-zA-Z0-9]{22}$/;

export async function PUT(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (
      (origin && new URL(origin).origin !== new URL(request.url).origin) ||
      (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site")
    ) {
      return Response.json(
        { error: "Cross-origin playback requests are not allowed." },
        { status: 403 },
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
    let body: PlaybackRequest;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json(
          { error: "A valid playback request is required." },
          { status: 400 },
        );
      }
      body = parsed as PlaybackRequest;
    } catch {
      return Response.json(
        { error: "A valid playback request is required." },
        { status: 400 },
      );
    }
    if (!body.deviceId || !DEVICE_ID.test(body.deviceId)) {
      return Response.json({ error: "The browser player is not ready." }, { status: 400 });
    }
    const hasContext = Boolean(body.contextUri);
    const hasTracks = Array.isArray(body.uris) && body.uris.length > 0;
    if (hasContext === hasTracks) {
      return Response.json(
        { error: "Choose either a Spotify context or one or more tracks." },
        { status: 400 },
      );
    }
    if (body.contextUri && !CONTEXT_URI.test(body.contextUri)) {
      return Response.json({ error: "This Spotify context is invalid." }, { status: 400 });
    }
    if (body.offsetUri && !TRACK_URI.test(body.offsetUri)) {
      return Response.json({ error: "This starting track is invalid." }, { status: 400 });
    }
    if (body.offsetUri && !body.contextUri) {
      return Response.json(
        { error: "A starting track requires an album or playlist context." },
        { status: 400 },
      );
    }
    if (body.offsetUri && body.contextUri?.startsWith("spotify:artist:")) {
      return Response.json(
        { error: "Artist playback cannot start from a specific track." },
        { status: 400 },
      );
    }
    if (
      body.uris &&
      (body.uris.length > 100 || body.uris.some((uri) => !TRACK_URI.test(uri)))
    ) {
      return Response.json({ error: "One or more Spotify tracks are invalid." }, { status: 400 });
    }

    const playbackBody = body.contextUri
      ? {
          context_uri: body.contextUri,
          ...(body.offsetUri ? { offset: { uri: body.offsetUri } } : {}),
          position_ms: 0,
        }
      : { uris: body.uris, position_ms: 0 };
    const play = await spotifyFetch(
      `/me/player/play?device_id=${encodeURIComponent(body.deviceId)}`,
      {
        method: "PUT",
        body: JSON.stringify(playbackBody),
      },
    );
    if (!play.ok) {
      throw await playbackError(play);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

async function playbackError(response: Response) {
  let message =
    response.status === 403
      ? "Spotify Premium and playback permission are required."
      : "Spotify could not start playback in this browser.";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the user-friendly fallback.
  }
  return new SpotifyError(message, response.status);
}
