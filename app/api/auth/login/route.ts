import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SPOTIFY_SCOPES } from "@/lib/spotify";

function randomString(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function base64Url(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.hostname === "localhost" && !process.env.SPOTIFY_REDIRECT_URI) {
    const loopback = new URL(request.url);
    loopback.hostname = "127.0.0.1";
    return NextResponse.redirect(loopback);
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/?auth_error=missing_config", request.url));
  }
  const verifier = randomString(72);
  const state = randomString(32);
  const challenge = base64Url(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI || `${requestUrl.origin}/api/auth/callback`;
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: requestUrl.protocol === "https:",
    path: "/",
    maxAge: 600,
  };
  const jar = await cookies();
  jar.set("spotify_oauth_state", state, options);
  jar.set("spotify_code_verifier", verifier, options);
  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES,
    state,
    code_challenge_method: "S256",
    code_challenge: challenge,
    ...(requestUrl.searchParams.get("reauthorize") === "1"
      ? { show_dialog: "true" }
      : {}),
  }).toString();
  return NextResponse.redirect(authorize);
}
