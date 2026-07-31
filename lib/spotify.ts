import { cookies } from "next/headers";

const API_ROOT = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "user-follow-read",
  "streaming",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
].join(" ");

export const PLAYBACK_SCOPES = [
  "streaming",
  "user-read-email",
  "user-read-private",
  "user-modify-playback-state",
];
export const PLAYLIST_MODIFY_SCOPES = [
  "playlist-modify-public",
  "playlist-modify-private",
];
export const LIBRARY_READ_SCOPES = ["user-library-read"];
export const LIBRARY_MODIFY_SCOPES = ["user-library-modify"];

export class SpotifyError extends Error {
  status: number;
  retryAfter?: number;
  code?: string;

  constructor(
    message: string,
    status: number,
    retryAfter?: number,
    code?: string,
  ) {
    super(message);
    this.name = "SpotifyError";
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export async function saveTokens(tokens: {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}) {
  const jar = await cookies();
  jar.set("spotify_access", tokens.access_token, cookieOptions(tokens.expires_in));
  jar.set(
    "spotify_expires",
    String(Date.now() + tokens.expires_in * 1000),
    cookieOptions(tokens.expires_in),
  );
  if (tokens.refresh_token) {
    jar.set("spotify_refresh", tokens.refresh_token, cookieOptions(60 * 60 * 24 * 180));
  }
  if (tokens.scope) {
    jar.set("spotify_scopes", tokens.scope, cookieOptions(60 * 60 * 24 * 180));
  }
}

export async function clearTokens() {
  const jar = await cookies();
  for (const name of [
    "spotify_access",
    "spotify_refresh",
    "spotify_expires",
    "spotify_scopes",
  ]) {
    jar.delete(name);
  }
}

export async function hasPlaybackScopes() {
  const jar = await cookies();
  const granted = new Set((jar.get("spotify_scopes")?.value || "").split(" "));
  return PLAYBACK_SCOPES.every((scope) => granted.has(scope));
}

export async function hasPlaylistModifyScopes() {
  const jar = await cookies();
  const granted = new Set((jar.get("spotify_scopes")?.value || "").split(" "));
  return PLAYLIST_MODIFY_SCOPES.every((scope) => granted.has(scope));
}

export async function hasLibraryReadScopes() {
  const jar = await cookies();
  const granted = new Set((jar.get("spotify_scopes")?.value || "").split(" "));
  return LIBRARY_READ_SCOPES.every((scope) => granted.has(scope));
}

export async function hasLibraryModifyScopes() {
  const jar = await cookies();
  const granted = new Set((jar.get("spotify_scopes")?.value || "").split(" "));
  return LIBRARY_MODIFY_SCOPES.every((scope) => granted.has(scope));
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) throw new SpotifyError("Spotify is not configured.", 503);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
    error?: string;
  };
  if (!response.ok || !data.access_token || !data.expires_in) {
    await clearTokens();
    throw new SpotifyError(
      data.error === "invalid_grant"
        ? "Your Spotify session expired. Please connect again."
        : "Could not refresh your Spotify session.",
      401,
    );
  }
  await saveTokens({
    access_token: data.access_token,
    expires_in: data.expires_in,
    refresh_token: data.refresh_token,
    scope: data.scope,
  });
  return data.access_token;
}

export async function getAccessToken() {
  const jar = await cookies();
  const access = jar.get("spotify_access")?.value;
  const expiresAt = Number(jar.get("spotify_expires")?.value || 0);
  if (access && expiresAt > Date.now() + 60_000) return access;
  const refresh = jar.get("spotify_refresh")?.value;
  if (!refresh) throw new SpotifyError("Connect Spotify to continue.", 401);
  return refreshAccessToken(refresh);
}

type SpotifyErrorBody = {
  message?: string;
  reason?: string;
  error?:
    | string
    | {
        message?: string;
        reason?: string;
      };
};

type SpotifyRetryPolicy = {
  maxRateLimitRetries?: number;
  maxServerRetries?: number;
};

let spotifyBlockedUntil = 0;

function delay(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("The Spotify request was cancelled.", "AbortError"),
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
        signal.reason ?? new DOMException("The Spotify request was cancelled.", "AbortError"),
      );
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function errorDetails(body: SpotifyErrorBody) {
  const nested = typeof body.error === "object" ? body.error : undefined;
  return {
    message:
      typeof body.error === "string"
        ? body.error
        : nested?.message || body.message,
    reason: nested?.reason || body.reason,
  };
}

async function responseErrorDetails(
  response: Response,
): Promise<{ message?: string; reason?: string }> {
  try {
    return errorDetails((await response.clone().json()) as SpotifyErrorBody);
  } catch {
    return {};
  }
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("Retry-After");
  const seconds = Number(retryAfter);
  if (retryAfter && Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const retryDate = retryAfter ? Date.parse(retryAfter) : Number.NaN;
  if (Number.isFinite(retryDate)) {
    return Math.max(0, retryDate - Date.now());
  }
  return Math.min(1000 * 2 ** attempt, 30_000);
}

export async function spotifyFetch(
  pathOrUrl: string,
  init: RequestInit = {},
  retryPolicy: SpotifyRetryPolicy = {},
): Promise<Response> {
  const signal = init.signal ?? undefined;
  const maxRateLimitRetries =
    retryPolicy.maxRateLimitRetries ?? Number.POSITIVE_INFINITY;
  const maxServerRetries = retryPolicy.maxServerRetries ?? 2;
  let rateLimitAttempts = 0;
  let serverAttempts = 0;

  while (true) {
    const gateDelay = spotifyBlockedUntil - Date.now();
    if (gateDelay > 0) await delay(gateDelay, signal);

    const accessToken = await getAccessToken();
    const response = await fetch(
      pathOrUrl.startsWith("http") ? pathOrUrl : `${API_ROOT}${pathOrUrl}`,
      {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      },
    );

    if (response.status === 429) {
      const details = await responseErrorDetails(response);
      if (details.reason === "QUOTA_EXCEEDED") return response;
      if (rateLimitAttempts >= maxRateLimitRetries) return response;

      const waitMs = retryDelayMs(response, rateLimitAttempts);
      rateLimitAttempts += 1;
      spotifyBlockedUntil = Math.max(
        spotifyBlockedUntil,
        Date.now() + waitMs + 250,
      );
      await delay(spotifyBlockedUntil - Date.now(), signal);
      continue;
    }

    if (response.status >= 500 && serverAttempts < maxServerRetries) {
      await delay(400 * 2 ** serverAttempts, signal);
      serverAttempts += 1;
      continue;
    }

    return response;
  }
}

export async function spotifyJson<T>(
  pathOrUrl: string,
  init: RequestInit = {},
  retryPolicy: SpotifyRetryPolicy = {},
) {
  const response = await spotifyFetch(pathOrUrl, init, retryPolicy);
  if (!response.ok) {
    let message = "Spotify could not complete this request.";
    let code: string | undefined;
    try {
      const details = errorDetails((await response.json()) as SpotifyErrorBody);
      if (details.message) message = details.message;
      if (details.reason === "QUOTA_EXCEEDED") {
        code = "quota_exceeded";
        message =
          "Spotify's Development Mode quota is exhausted. Spotify did not provide a retry time, so continue the scan later.";
      }
    } catch {
      // Keep the safe fallback message.
    }
    throw new SpotifyError(
      message,
      response.status,
      Number(response.headers.get("Retry-After") || 0) || undefined,
      code,
    );
  }
  return (await response.json()) as T;
}

export function apiError(error: unknown) {
  const known = error instanceof SpotifyError;
  return Response.json(
    {
      error: known ? error.message : "Something went wrong while talking to Spotify.",
      reconnect: known && (error.status === 401 || error.code === "reauthorize"),
      code: known ? error.code : undefined,
      retryAfter: known ? error.retryAfter : undefined,
    },
    { status: known ? error.status : 500 },
  );
}
