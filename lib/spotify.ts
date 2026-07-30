import { cookies } from "next/headers";

const API_ROOT = "https://api.spotify.com/v1";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-follow-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

export class SpotifyError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = "SpotifyError";
    this.status = status;
    this.retryAfter = retryAfter;
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
}

export async function clearTokens() {
  const jar = await cookies();
  for (const name of ["spotify_access", "spotify_refresh", "spotify_expires"]) {
    jar.delete(name);
  }
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

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function spotifyFetch(
  pathOrUrl: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<Response> {
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
  if (response.status === 429 && attempt < 2) {
    const retryAfter = Math.min(Number(response.headers.get("Retry-After") || 1), 10);
    await delay(retryAfter * 1000);
    return spotifyFetch(pathOrUrl, init, attempt + 1);
  }
  if (response.status >= 500 && attempt < 2) {
    await delay(400 * 2 ** attempt);
    return spotifyFetch(pathOrUrl, init, attempt + 1);
  }
  return response;
}

export async function spotifyJson<T>(pathOrUrl: string, init: RequestInit = {}) {
  const response = await spotifyFetch(pathOrUrl, init);
  if (!response.ok) {
    let message = "Spotify could not complete this request.";
    try {
      const body = (await response.json()) as {
        error?: { message?: string; reason?: string } | string;
      };
      if (typeof body.error === "string") message = body.error;
      else if (body.error?.message) message = body.error.message;
      if (
        body.error &&
        typeof body.error !== "string" &&
        body.error.reason === "QUOTA_EXCEEDED"
      ) {
        message = "This Spotify developer account has reached its request quota.";
      }
    } catch {
      // Keep the safe fallback message.
    }
    throw new SpotifyError(
      message,
      response.status,
      Number(response.headers.get("Retry-After") || 0) || undefined,
    );
  }
  return (await response.json()) as T;
}

export function apiError(error: unknown) {
  const known = error instanceof SpotifyError;
  return Response.json(
    {
      error: known ? error.message : "Something went wrong while talking to Spotify.",
      reconnect: known && error.status === 401,
      retryAfter: known ? error.retryAfter : undefined,
    },
    { status: known ? error.status : 500 },
  );
}
