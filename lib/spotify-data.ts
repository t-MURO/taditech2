type UnknownRecord = Record<string, unknown>;

export type SpotifyImage = {
  url: string;
};

export type NormalizedSpotifyTrack = {
  id: string | null;
  uri: string;
  name: string;
  type: string;
  duration_ms?: number;
  explicit?: boolean;
  popularity?: number;
  external_urls?: { spotify: string };
  artists?: Array<{
    id: string;
    name: string;
    external_urls?: { spotify: string };
  }>;
  album?: {
    id: string;
    name: string;
    release_date?: string;
    images: SpotifyImage[];
    external_urls?: { spotify: string };
  };
};

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null
    ? value as UnknownRecord
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function normalizeExternalUrl(value: unknown): { spotify: string } | undefined {
  const url = nonEmptyString(asRecord(value)?.spotify);
  return url ? { spotify: url } : undefined;
}

export function normalizeSpotifyImages(value: unknown): SpotifyImage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((image) => {
    const url = nonEmptyString(asRecord(image)?.url);
    return url ? [{ url }] : [];
  });
}

export function preferredSpotifyImage(value: unknown): string | undefined {
  const images = normalizeSpotifyImages(value);
  return images[1]?.url ?? images[0]?.url;
}

export function normalizeSpotifyTrack(
  value: unknown,
  fallbackIndex: number,
): NormalizedSpotifyTrack {
  const track = asRecord(value);
  if (!track) {
    return {
      id: null,
      uri: `spotify:unavailable:${fallbackIndex}`,
      name: "Unavailable item",
      type: "unknown",
    };
  }

  const id = nonEmptyString(track.id) ?? null;
  const uri = nonEmptyString(track.uri) ?? `spotify:unavailable:${fallbackIndex}`;
  const name = nonEmptyString(track.name) ?? "Unavailable item";
  const type = nonEmptyString(track.type) ?? "unknown";
  const duration = nonNegativeNumber(track.duration_ms);
  const popularity = nonNegativeNumber(track.popularity);
  const externalUrls = normalizeExternalUrl(track.external_urls);

  const artists = Array.isArray(track.artists)
    ? track.artists.flatMap((value) => {
        const artist = asRecord(value);
        const artistName = nonEmptyString(artist?.name);
        if (!artist || !artistName) return [];

        const artistUrl = normalizeExternalUrl(artist.external_urls);
        return [{
          id: nonEmptyString(artist.id) ?? "",
          name: artistName,
          ...(artistUrl ? { external_urls: artistUrl } : {}),
        }];
      })
    : undefined;

  const rawAlbum = asRecord(track.album);
  const albumReleaseDate = nonEmptyString(rawAlbum?.release_date);
  const albumExternalUrls = normalizeExternalUrl(rawAlbum?.external_urls);
  const album = rawAlbum
    ? {
        id: nonEmptyString(rawAlbum.id) ?? "",
        name: nonEmptyString(rawAlbum.name) ?? "Unknown album",
        images: normalizeSpotifyImages(rawAlbum.images),
        ...(albumReleaseDate ? { release_date: albumReleaseDate } : {}),
        ...(albumExternalUrls ? { external_urls: albumExternalUrls } : {}),
      }
    : undefined;

  return {
    id,
    uri,
    name,
    type,
    ...(duration !== undefined ? { duration_ms: duration } : {}),
    ...(typeof track.explicit === "boolean" ? { explicit: track.explicit } : {}),
    ...(popularity !== undefined ? { popularity } : {}),
    ...(externalUrls ? { external_urls: externalUrls } : {}),
    ...(artists ? { artists } : {}),
    ...(album ? { album } : {}),
  };
}
