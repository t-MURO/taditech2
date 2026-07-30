export type SpotifyLinkKind =
  | "album"
  | "artist"
  | "audiobook"
  | "episode"
  | "playlist"
  | "show"
  | "track"
  | "user";

type SpotifyAppLink = {
  uri?: string | null;
  kind?: SpotifyLinkKind;
  id?: string | null;
  webUrl?: string | null;
};

const SPOTIFY_URI =
  /^spotify:(album|artist|audiobook|episode|playlist|show|track|user):([a-zA-Z0-9]+)$/;
const SPOTIFY_ID = /^[a-zA-Z0-9]+$/;

function validSpotifyWebUrl(value?: string | null) {
  if (!value?.trim()) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      (url.hostname === "open.spotify.com" || url.hostname === "www.open.spotify.com")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function spotifyAppUri(
  kind: SpotifyLinkKind,
  id?: string | null,
) {
  const normalizedId = id?.trim();
  return normalizedId && SPOTIFY_ID.test(normalizedId)
    ? `spotify:${kind}:${normalizedId}`
    : undefined;
}

export function spotifyAppUriFromWebUrl(value?: string | null) {
  const webUrl = validSpotifyWebUrl(value);
  if (!webUrl) return undefined;

  const segments = new URL(webUrl).pathname
    .split("/")
    .filter(Boolean);
  if (segments[0]?.startsWith("intl-")) segments.shift();

  const [kind, id] = segments;
  return SPOTIFY_URI.test(`spotify:${kind}:${id}`)
    ? `spotify:${kind}:${id}`
    : undefined;
}

/**
 * Prefer Spotify's native-app URI. The HTTPS URL is kept only as a safe
 * fallback for older or incomplete API objects that do not contain enough
 * information to build a deep link.
 */
export function spotifyAppHref({
  uri,
  kind,
  id,
  webUrl,
}: SpotifyAppLink) {
  const normalizedUri = uri?.trim();
  if (normalizedUri && SPOTIFY_URI.test(normalizedUri)) return normalizedUri;

  return (
    (kind ? spotifyAppUri(kind, id) : undefined) ??
    spotifyAppUriFromWebUrl(webUrl) ??
    validSpotifyWebUrl(webUrl)
  );
}
