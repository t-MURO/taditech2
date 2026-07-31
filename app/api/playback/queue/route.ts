import {
  apiError,
  hasPlaybackScopes,
  spotifyFetch,
  SpotifyError,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

type QueueRequest = {
  deviceId?: string;
  uri?: string;
};

const DEVICE_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const TRACK_URI = /^spotify:track:[a-zA-Z0-9]{22}$/;
const DEVICE_REGISTRATION_RETRY_DELAYS_MS = [250, 500, 1_000];

export async function POST(request: Request) {
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
        "Reconnect Spotify to grant queue permission.",
        403,
        undefined,
        "reauthorize",
      );
    }

    let body: QueueRequest;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json(
          { error: "A valid queue request is required." },
          { status: 400 },
        );
      }
      body = parsed as QueueRequest;
    } catch {
      return Response.json(
        { error: "A valid queue request is required." },
        { status: 400 },
      );
    }

    if (!body.uri || !TRACK_URI.test(body.uri)) {
      return Response.json(
        { error: "This Spotify track is invalid." },
        { status: 400 },
      );
    }
    if (body.deviceId !== undefined && !DEVICE_ID.test(body.deviceId)) {
      return Response.json(
        { error: "The browser player is not ready." },
        { status: 400 },
      );
    }

    const params = new URLSearchParams({ uri: body.uri });
    if (body.deviceId) params.set("device_id", body.deviceId);
    const queueUrl = `/me/player/queue?${params.toString()}`;
    let queued = await spotifyFetch(queueUrl, {
      method: "POST",
      signal: request.signal,
    });
    for (const retryDelay of DEVICE_REGISTRATION_RETRY_DELAYS_MS) {
      if (queued.status !== 404 || !body.deviceId) break;
      await queued.body?.cancel();
      await delay(retryDelay, request.signal);
      queued = await spotifyFetch(queueUrl, {
        method: "POST",
        signal: request.signal,
      });
    }
    if (!queued.ok) throw await queueError(queued);

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

async function queueError(response: Response) {
  let message =
    response.status === 403
      ? "Spotify Premium and playback permission are required."
      : "Spotify could not add this track to the queue.";
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the user-friendly fallback.
  }
  if (response.status === 404) {
    return new SpotifyError(
      "No active Spotify player is available. Start playback, then try again.",
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
      signal.reason ?? new DOMException("Queue request was cancelled.", "AbortError"),
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
        signal.reason ?? new DOMException("Queue request was cancelled.", "AbortError"),
      );
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}
