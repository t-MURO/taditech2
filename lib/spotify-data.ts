type UnknownRecord = Record<string, unknown>;

export type SpotifyImage = {
  url: string;
  height?: number | null;
  width?: number | null;
};

export type SpotifyExternalUrls = {
  spotify: string;
};

export type NormalizedSpotifyArtist = {
  id: string;
  name: string;
  uri?: string;
  href?: string;
  type?: string;
  external_urls?: SpotifyExternalUrls;
};

export type NormalizedSpotifyUserReference = {
  id?: string;
  uri?: string;
  href?: string;
  type?: string;
  external_urls?: SpotifyExternalUrls;
};

export type SpotifyRestrictions = {
  reason: string;
};

export type SpotifyExternalIds = {
  isrc?: string;
  ean?: string;
  upc?: string;
};

export type NormalizedSpotifyAlbum = {
  id: string;
  name: string;
  uri?: string;
  href?: string;
  type?: string;
  album_type?: string;
  total_tracks?: number;
  release_date?: string;
  release_date_precision?: string;
  restrictions?: SpotifyRestrictions;
  images: SpotifyImage[];
  external_urls?: SpotifyExternalUrls;
  artists?: NormalizedSpotifyArtist[];
};

export type NormalizedSpotifyTrack = {
  id: string | null;
  uri: string;
  name: string;
  type: string;
  href?: string;
  preview_url?: string | null;
  duration_ms?: number;
  explicit?: boolean;
  track_number?: number;
  disc_number?: number;
  is_playable?: boolean;
  is_local?: boolean;
  restrictions?: SpotifyRestrictions;
  external_ids?: SpotifyExternalIds;
  external_urls?: SpotifyExternalUrls;
  artists?: NormalizedSpotifyArtist[];
  album?: NormalizedSpotifyAlbum;
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

function nullableNonNegativeNumber(
  value: unknown,
): number | null | undefined {
  return value === null ? null : nonNegativeNumber(value);
}

function normalizeExternalUrl(value: unknown): SpotifyExternalUrls | undefined {
  const url = nonEmptyString(asRecord(value)?.spotify);
  return url ? { spotify: url } : undefined;
}

function normalizeRestrictions(value: unknown): SpotifyRestrictions | undefined {
  const reason = nonEmptyString(asRecord(value)?.reason);
  return reason ? { reason } : undefined;
}

function normalizeExternalIds(value: unknown): SpotifyExternalIds | undefined {
  const externalIds = asRecord(value);
  if (!externalIds) return undefined;

  const isrc = nonEmptyString(externalIds.isrc);
  const ean = nonEmptyString(externalIds.ean);
  const upc = nonEmptyString(externalIds.upc);
  if (!isrc && !ean && !upc) return undefined;

  return {
    ...(isrc ? { isrc } : {}),
    ...(ean ? { ean } : {}),
    ...(upc ? { upc } : {}),
  };
}

function normalizeArtist(value: unknown): NormalizedSpotifyArtist | undefined {
  const artist = asRecord(value);
  const name = nonEmptyString(artist?.name);
  if (!artist || !name) return undefined;

  const uri = nonEmptyString(artist.uri);
  const href = nonEmptyString(artist.href);
  const type = nonEmptyString(artist.type);
  const externalUrls = normalizeExternalUrl(artist.external_urls);
  return {
    id: nonEmptyString(artist.id) ?? "",
    name,
    ...(uri ? { uri } : {}),
    ...(href ? { href } : {}),
    ...(type ? { type } : {}),
    ...(externalUrls ? { external_urls: externalUrls } : {}),
  };
}

function normalizeArtists(value: unknown): NormalizedSpotifyArtist[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((artist) => {
    const normalized = normalizeArtist(artist);
    return normalized ? [normalized] : [];
  });
}

export function normalizeSpotifyUserReference(
  value: unknown,
): NormalizedSpotifyUserReference | undefined {
  const user = asRecord(value);
  if (!user) return undefined;

  const id = nonEmptyString(user.id);
  const uri = nonEmptyString(user.uri);
  const href = nonEmptyString(user.href);
  const type = nonEmptyString(user.type);
  const externalUrls = normalizeExternalUrl(user.external_urls);
  if (!id && !uri && !href && !type && !externalUrls) return undefined;

  return {
    ...(id ? { id } : {}),
    ...(uri ? { uri } : {}),
    ...(href ? { href } : {}),
    ...(type ? { type } : {}),
    ...(externalUrls ? { external_urls: externalUrls } : {}),
  };
}

export function normalizeSpotifyImages(value: unknown): SpotifyImage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((image) => {
    const rawImage = asRecord(image);
    const url = nonEmptyString(rawImage?.url);
    if (!url) return [];

    const height = nullableNonNegativeNumber(rawImage?.height);
    const width = nullableNonNegativeNumber(rawImage?.width);
    return [{
      url,
      ...(height !== undefined ? { height } : {}),
      ...(width !== undefined ? { width } : {}),
    }];
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
  const href = nonEmptyString(track.href);
  const previewUrl = track.preview_url === null
    ? null
    : nonEmptyString(track.preview_url);
  const duration = nonNegativeNumber(track.duration_ms);
  const trackNumber = nonNegativeNumber(track.track_number);
  const discNumber = nonNegativeNumber(track.disc_number);
  const restrictions = normalizeRestrictions(track.restrictions);
  const externalIds = normalizeExternalIds(track.external_ids);
  const externalUrls = normalizeExternalUrl(track.external_urls);
  const artists = normalizeArtists(track.artists);

  const rawAlbum = asRecord(track.album);
  const albumUri = nonEmptyString(rawAlbum?.uri);
  const albumHref = nonEmptyString(rawAlbum?.href);
  const albumObjectType = nonEmptyString(rawAlbum?.type);
  const albumType = nonEmptyString(rawAlbum?.album_type);
  const albumTotalTracks = nonNegativeNumber(rawAlbum?.total_tracks);
  const albumReleaseDate = nonEmptyString(rawAlbum?.release_date);
  const albumReleaseDatePrecision = nonEmptyString(
    rawAlbum?.release_date_precision,
  );
  const albumRestrictions = normalizeRestrictions(rawAlbum?.restrictions);
  const albumExternalUrls = normalizeExternalUrl(rawAlbum?.external_urls);
  const albumArtists = normalizeArtists(rawAlbum?.artists);
  const album = rawAlbum
    ? {
        id: nonEmptyString(rawAlbum.id) ?? "",
        name: nonEmptyString(rawAlbum.name) ?? "Unknown album",
        ...(albumUri ? { uri: albumUri } : {}),
        ...(albumHref ? { href: albumHref } : {}),
        ...(albumObjectType ? { type: albumObjectType } : {}),
        ...(albumType ? { album_type: albumType } : {}),
        ...(albumTotalTracks !== undefined
          ? { total_tracks: albumTotalTracks }
          : {}),
        images: normalizeSpotifyImages(rawAlbum.images),
        ...(albumReleaseDate ? { release_date: albumReleaseDate } : {}),
        ...(albumReleaseDatePrecision
          ? { release_date_precision: albumReleaseDatePrecision }
          : {}),
        ...(albumRestrictions ? { restrictions: albumRestrictions } : {}),
        ...(albumExternalUrls ? { external_urls: albumExternalUrls } : {}),
        ...(albumArtists ? { artists: albumArtists } : {}),
      }
    : undefined;

  return {
    id,
    uri,
    name,
    type,
    ...(href ? { href } : {}),
    ...(previewUrl !== undefined ? { preview_url: previewUrl } : {}),
    ...(duration !== undefined ? { duration_ms: duration } : {}),
    ...(typeof track.explicit === "boolean" ? { explicit: track.explicit } : {}),
    ...(trackNumber !== undefined ? { track_number: trackNumber } : {}),
    ...(discNumber !== undefined ? { disc_number: discNumber } : {}),
    ...(typeof track.is_playable === "boolean"
      ? { is_playable: track.is_playable }
      : {}),
    ...(typeof track.is_local === "boolean"
      ? { is_local: track.is_local }
      : {}),
    ...(restrictions ? { restrictions } : {}),
    ...(externalIds ? { external_ids: externalIds } : {}),
    ...(externalUrls ? { external_urls: externalUrls } : {}),
    ...(artists ? { artists } : {}),
    ...(album ? { album } : {}),
  };
}
