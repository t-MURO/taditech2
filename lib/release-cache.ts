import type {
  Release,
  ReleaseArtist,
  ReleaseBatch,
  ReleaseDatePrecision,
  ReleaseImage,
  ReleaseScanSnapshot,
} from "./release-data";

export const RELEASE_CACHE_NAME = "taditech-release-pages-v1";
export const COMPLETE_RELEASE_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const PARTIAL_RELEASE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CACHE_PATH_PREFIX = "/__taditech-cache/releases/v1/";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : null;
}

function normalizeOptionalDimension(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = finiteNonNegativeInteger(value);
  return normalized === null ? undefined : normalized;
}

function normalizeImage(value: unknown): ReleaseImage | null {
  if (!isRecord(value) || typeof value.url !== "string" || !value.url) {
    return null;
  }
  const width = normalizeOptionalDimension(value.width);
  const height = normalizeOptionalDimension(value.height);
  if (
    (value.width !== undefined && width === undefined) ||
    (value.height !== undefined && height === undefined)
  ) {
    return null;
  }
  return {
    url: value.url,
    ...(value.width !== undefined ? { width } : {}),
    ...(value.height !== undefined ? { height } : {}),
  };
}

function normalizeSpotifyUrl(value: unknown): { spotify: string } | undefined {
  if (!isRecord(value) || typeof value.spotify !== "string" || !value.spotify) {
    return undefined;
  }
  return { spotify: value.spotify };
}

function normalizeArtist(value: unknown): ReleaseArtist | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name
  ) {
    return null;
  }
  const externalUrls =
    value.external_urls === undefined
      ? undefined
      : normalizeSpotifyUrl(value.external_urls);
  if (value.external_urls !== undefined && !externalUrls) return null;
  return {
    id: value.id,
    name: value.name,
    ...(externalUrls ? { external_urls: externalUrls } : {}),
  };
}

function validReleaseDate(
  date: string,
  precision: ReleaseDatePrecision,
): boolean {
  if (precision === "year") return /^\d{4}$/.test(date);

  const match =
    precision === "month"
      ? /^(\d{4})-(\d{2})$/.exec(date)
      : /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  if (precision === "month") return true;

  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function normalizeRelease(value: unknown): Release | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.name !== "string" ||
    !value.name ||
    !["album", "single", "compilation"].includes(String(value.album_type)) ||
    typeof value.release_date !== "string" ||
    !["day", "month", "year"].includes(String(value.release_date_precision))
  ) {
    return null;
  }

  const albumType = value.album_type as Release["album_type"];
  const precision = value.release_date_precision as ReleaseDatePrecision;
  if (!validReleaseDate(value.release_date, precision)) return null;

  const totalTracks = finiteNonNegativeInteger(value.total_tracks);
  if (
    totalTracks === null ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.artists)
  ) {
    return null;
  }

  const images = value.images.map(normalizeImage);
  const artists = value.artists.map(normalizeArtist);
  const externalUrls = normalizeSpotifyUrl(value.external_urls);
  if (
    images.some((image) => image === null) ||
    artists.length === 0 ||
    artists.some((artist) => artist === null) ||
    !externalUrls
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    album_type: albumType,
    release_date: value.release_date,
    release_date_precision: precision,
    total_tracks: totalTracks,
    images: images as ReleaseImage[],
    artists: artists as ReleaseArtist[],
    external_urls: externalUrls,
  };
}

/**
 * Validates and sanitizes an API batch before it can enter the device cache.
 * Unknown fields are intentionally discarded, so credentials or unrelated
 * response data can never be persisted accidentally.
 */
export function normalizeReleaseBatch(value: unknown): ReleaseBatch | null {
  const fetchedAt =
    isRecord(value) && typeof value.fetchedAt === "string"
      ? Date.parse(value.fetchedAt)
      : Number.NaN;
  if (
    !isRecord(value) ||
    !Array.isArray(value.releases) ||
    typeof value.complete !== "boolean" ||
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(fetchedAt) ||
    new Date(fetchedAt).toISOString() !== value.fetchedAt
  ) {
    return null;
  }

  const artistCount =
    value.artistCount === null ? null : finiteNonNegativeInteger(value.artistCount);
  const scannedArtists = finiteNonNegativeInteger(value.scannedArtists);
  const nextCursor =
    value.nextCursor === null
      ? null
      : typeof value.nextCursor === "string" && value.nextCursor
        ? value.nextCursor
        : undefined;
  if (
    (artistCount === null && value.artistCount !== null) ||
    scannedArtists === null ||
    nextCursor === undefined ||
    value.complete !== (nextCursor === null)
  ) {
    return null;
  }

  const releases = value.releases.map(normalizeRelease);
  if (releases.some((release) => release === null)) return null;

  return {
    releases: releases as Release[],
    artistCount,
    scannedArtists,
    nextCursor,
    complete: value.complete,
    fetchedAt: value.fetchedAt,
  };
}

export function releaseCacheIsFresh(
  batches: readonly ReleaseBatch[],
  complete: boolean,
  now = Date.now(),
): boolean {
  if (batches.length === 0) return false;
  const maxAge = complete
    ? COMPLETE_RELEASE_CACHE_MAX_AGE_MS
    : PARTIAL_RELEASE_CACHE_MAX_AGE_MS;
  return batches.every((batch) => {
    const fetchedAt = Date.parse(batch.fetchedAt);
    return (
      Number.isFinite(fetchedAt) &&
      fetchedAt <= now + MAX_CLOCK_SKEW_MS &&
      now - fetchedAt <= maxAge
    );
  });
}

function browserCacheStorage(): CacheStorage | null {
  return typeof window !== "undefined" && "caches" in window
    ? window.caches
    : null;
}

function normalizedAccountId(accountId: string): string | null {
  const normalized = accountId.trim();
  return normalized ? normalized : null;
}

function accountCachePath(accountId: string): string {
  return `${CACHE_PATH_PREFIX}${encodeURIComponent(accountId)}`;
}

function pageRequest(accountId: string, cursor: string | null): Request {
  const url = new URL(accountCachePath(accountId), window.location.origin);
  if (cursor) url.searchParams.set("after", cursor);
  return new Request(url, { method: "GET" });
}

/**
 * Writes only a normalized Spotify response page. Cache failures never fail a
 * release scan because this cache is an optional device-local accelerator.
 */
export async function writeCachedReleaseBatch(
  accountId: string,
  requestedCursor: string | null,
  value: unknown,
): Promise<boolean> {
  const storage = browserCacheStorage();
  const account = normalizedAccountId(accountId);
  const batch = normalizeReleaseBatch(value);
  if (!storage || !account || !batch) return false;

  try {
    const cache = await storage.open(RELEASE_CACHE_NAME);
    await cache.put(
      pageRequest(account, requestedCursor),
      new Response(JSON.stringify(batch), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function readCachedReleaseBatch(
  accountId: string,
  requestedCursor: string | null,
): Promise<ReleaseBatch | null> {
  const storage = browserCacheStorage();
  const account = normalizedAccountId(accountId);
  if (!storage || !account) return null;

  try {
    const cache = await storage.open(RELEASE_CACHE_NAME);
    const request = pageRequest(account, requestedCursor);
    const response = await cache.match(request);
    if (!response) return null;
    const batch = normalizeReleaseBatch(await response.json());
    if (!batch) await cache.delete(request);
    return batch;
  } catch {
    return null;
  }
}

export async function clearCachedReleaseScan(
  accountId: string,
): Promise<boolean> {
  const storage = browserCacheStorage();
  const account = normalizedAccountId(accountId);
  if (!storage || !account) return false;

  try {
    const cache = await storage.open(RELEASE_CACHE_NAME);
    const accountPath = accountCachePath(account);
    const requests = await cache.keys();
    await Promise.all(
      requests
        .filter((request) => new URL(request.url).pathname === accountPath)
        .map((request) => cache.delete(request)),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuilds the longest valid cursor chain already on this device. A missing
 * page yields a resumable partial snapshot; no network request is made.
 */
export async function loadCachedReleaseScan(
  accountId: string,
  now = Date.now(),
): Promise<ReleaseScanSnapshot | null> {
  const releases = new Map<string, Release>();
  const batches: ReleaseBatch[] = [];
  const seenCursors = new Set<string>();
  let requestedCursor: string | null = null;
  let nextCursor: string | null = null;
  let artistCount: number | null = null;
  let scannedArtists = 0;
  let complete = false;

  while (true) {
    const cursorKey = requestedCursor ?? "__first__";
    if (seenCursors.has(cursorKey)) {
      await clearCachedReleaseScan(accountId);
      return null;
    }
    seenCursors.add(cursorKey);

    const batch = await readCachedReleaseBatch(accountId, requestedCursor);
    if (!batch) {
      nextCursor = requestedCursor;
      break;
    }

    batches.push(batch);
    for (const release of batch.releases) releases.set(release.id, release);
    scannedArtists += batch.scannedArtists;
    if (batch.artistCount !== null) {
      artistCount = Math.max(artistCount ?? 0, batch.artistCount, scannedArtists);
    }

    if (batch.complete) {
      complete = true;
      nextCursor = null;
      break;
    }
    requestedCursor = batch.nextCursor;
  }

  if (batches.length === 0 || !releaseCacheIsFresh(batches, complete, now)) {
    if (batches.length > 0) await clearCachedReleaseScan(accountId);
    return null;
  }

  const fetchedAt = new Date(
    Math.max(...batches.map((batch) => Date.parse(batch.fetchedAt))),
  ).toISOString();
  return {
    releases: Array.from(releases.values()).sort((a, b) =>
      b.release_date.localeCompare(a.release_date),
    ),
    artistCount,
    scannedArtists,
    nextCursor,
    complete,
    fetchedAt,
  };
}
