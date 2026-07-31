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
  offsetPosition?: number;
  offsetUri?: string;
  uris?: string[];
};

const DEVICE_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TRACK_URI = /^spotify:track:[a-zA-Z0-9]{22}$/;
const CONTEXT_URI = /^spotify:(album|artist|playlist):[a-zA-Z0-9]{22}$/;
const DEVICE_REGISTRATION_RETRY_DELAYS_MS = [250, 500, 1_000];

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
    if (
      body.offsetPosition !== undefined &&
      (!Number.isInteger(body.offsetPosition) || body.offsetPosition < 0)
    ) {
      return Response.json(
        { error: "This starting position is invalid." },
        { status: 400 },
      );
    }
    if (body.offsetUri && body.offsetPosition !== undefined) {
      return Response.json(
        { error: "Choose either a starting track or a starting position." },
        { status: 400 },
      );
    }
    if ((body.offsetUri || body.offsetPosition !== undefined) && !body.contextUri) {
      return Response.json(
        { error: "A starting track requires an album or playlist context." },
        { status: 400 },
      );
    }
    if (
      (body.offsetUri || body.offsetPosition !== undefined) &&
      body.contextUri?.startsWith("spotify:artist:")
    ) {
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
          ...(body.offsetUri
            ? { offset: { uri: body.offsetUri } }
            : body.offsetPosition !== undefined
              ? { offset: { position: body.offsetPosition } }
              : {}),
          position_ms: 0,
        }
      : { uris: body.uris, position_ms: 0 };
    const playUrl = `/me/player/play?device_id=${encodeURIComponent(body.deviceId)}`;
    const serializedPlaybackBody = JSON.stringify(playbackBody);
    let play = await spotifyFetch(playUrl, {
      method: "PUT",
      body: serializedPlaybackBody,
      signal: request.signal,
    });
    for (const retryDelay of DEVICE_REGISTRATION_RETRY_DELAYS_MS) {
      if (play.status !== 404) break;
      await play.body?.cancel();
      await delay(retryDelay, request.signal);
      play = await spotifyFetch(playUrl, {
        method: "PUT",
        body: serializedPlaybackBody,
        signal: request.signal,
      });
    }
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
  if (response.status === 404) {
    return new SpotifyError(
      "Spotify could not see this browser player yet. It is reconnecting; try Play again in a moment.",
      409,
      undefined,
      "playback_device_unavailable",
    );
  }
  return new SpotifyError(message, response.status);
}

function delay(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Playback was cancelled.", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timer);
      reject(
        signal.reason ?? new DOMException("Playback was cancelled.", "AbortError"),
      );
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}
