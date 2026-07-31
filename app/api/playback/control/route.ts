import {
  apiError,
  hasPlaybackScopes,
  spotifyFetch,
  SpotifyError,
} from "@/lib/spotify";

export const dynamic = "force-dynamic";

type PlaybackControl = "next" | "pause" | "play" | "previous";
type PlaybackControlRequest = {
  action?: unknown;
  deviceId?: unknown;
};

const DEVICE_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const ACTIONS = new Set<PlaybackControl>([
  "next",
  "pause",
  "play",
  "previous",
]);
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
        "Reconnect Spotify to grant browser playback permission.",
        403,
        undefined,
        "reauthorize",
      );
    }

    let body: PlaybackControlRequest;
    try {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json(
          { error: "A valid playback control is required." },
          { status: 400 },
        );
      }
      body = parsed as PlaybackControlRequest;
    } catch {
      return Response.json(
        { error: "A valid playback control is required." },
        { status: 400 },
      );
    }

    if (
      typeof body.action !== "string" ||
      !ACTIONS.has(body.action as PlaybackControl)
    ) {
      return Response.json(
        { error: "This playback control is invalid." },
        { status: 400 },
      );
    }
    if (typeof body.deviceId !== "string" || !DEVICE_ID.test(body.deviceId)) {
      return Response.json(
        { error: "The browser player is not ready." },
        { status: 400 },
      );
    }

    const action = body.action as PlaybackControl;
    const method = action === "play" || action === "pause" ? "PUT" : "POST";
    const path = action === "previous" ? "previous" : action;
    const controlUrl =
      `/me/player/${path}?device_id=${encodeURIComponent(body.deviceId)}`;
    let response = await spotifyFetch(controlUrl, {
      method,
      signal: request.signal,
    });
    for (const retryDelay of DEVICE_REGISTRATION_RETRY_DELAYS_MS) {
      if (response.status !== 404) break;
      await response.body?.cancel();
      await delay(retryDelay, request.signal);
      response = await spotifyFetch(controlUrl, {
        method,
        signal: request.signal,
      });
    }
    if (!response.ok) throw await controlError(response, action);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

async function controlError(response: Response, action: PlaybackControl) {
  let message =
    response.status === 403
      ? "Spotify Premium and playback permission are required."
      : `Spotify could not ${controlLabel(action)}.`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) message = body.error.message;
  } catch {
    // Keep the user-friendly fallback.
  }
  if (response.status === 404) {
    return new SpotifyError(
      "Spotify could not see this browser player. It is reconnecting; try again in a moment.",
      409,
      undefined,
      "playback_device_unavailable",
    );
  }
  return new SpotifyError(message, response.status);
}

function controlLabel(action: PlaybackControl) {
  if (action === "next") return "skip to the next track";
  if (action === "previous") return "return to the previous track";
  if (action === "pause") return "pause playback";
  return "resume playback";
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
