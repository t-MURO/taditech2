import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { saveTokens } from "@/lib/spotify";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const expectedState = jar.get("spotify_oauth_state")?.value;
  const verifier = jar.get("spotify_code_verifier")?.value;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  jar.delete("spotify_oauth_state");
  jar.delete("spotify_code_verifier");
  if (!code || !verifier || !state || state !== expectedState) {
    return NextResponse.redirect(new URL("/?auth_error=invalid_state", request.url));
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/?auth_error=missing_config", request.url));
  }
  const redirectUri =
    process.env.SPOTIFY_REDIRECT_URI || `${url.origin}/api/auth/callback`;
  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const tokens = (await tokenResponse.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    scope?: string;
  };
  if (!tokenResponse.ok || !tokens.access_token || !tokens.expires_in) {
    return NextResponse.redirect(new URL("/?auth_error=token_exchange", request.url));
  }
  await saveTokens({
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
  });
  return NextResponse.redirect(new URL("/?connected=1", request.url));
}
