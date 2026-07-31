export type ReleaseDatePrecision = "day" | "month" | "year";

export type ReleaseImage = {
  url: string;
  width?: number | null;
  height?: number | null;
};

export type ReleaseArtist = {
  id: string;
  name: string;
  external_urls?: { spotify: string };
};

export type Release = {
  id: string;
  name: string;
  album_type: "album" | "single" | "compilation";
  release_date: string;
  release_date_precision: ReleaseDatePrecision;
  total_tracks: number;
  images: ReleaseImage[];
  artists: ReleaseArtist[];
  external_urls: { spotify: string };
};

export type ReleaseBatch = {
  releases: Release[];
  artistCount: number | null;
  scannedArtists: number;
  nextCursor: string | null;
  complete: boolean;
  fetchedAt: string;
};

export type ReleaseScanSnapshot = {
  releases: Release[];
  artistCount: number | null;
  scannedArtists: number;
  nextCursor: string | null;
  complete: boolean;
  fetchedAt: string;
};

export type ReleaseDateLike = {
  release_date?: string | null;
};

export type ReleaseMonth = {
  key: string;
  label: string;
};

export type ReleaseMonthGroup<T> = ReleaseMonth & {
  releases: T[];
};

const UNKNOWN_MONTH: ReleaseMonth = {
  key: "unknown",
  label: "Release date unknown",
};
const RELEASE_MONTH_FORMATTER = new Intl.DateTimeFormat("en", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const releaseMonthCache = new Map<string, ReleaseMonth>();

/**
 * Converts Spotify's day-, month-, and year-precision release dates into a
 * stable group. Spotify uses YYYY-MM-DD, YYYY-MM, or YYYY depending on the
 * album's release_date_precision.
 */
export function releaseMonth(date?: string | null): ReleaseMonth {
  if (!date) return UNKNOWN_MONTH;

  const monthMatch = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(date);
  if (monthMatch) {
    const [, year, month] = monthMatch;
    const monthNumber = Number(month);
    if (monthNumber >= 1 && monthNumber <= 12) {
      const key = `${year}-${month}`;
      const cached = releaseMonthCache.get(key);
      if (cached) return cached;
      const parsed = new Date(`${year}-${month}-01T00:00:00Z`);
      const monthInfo = {
        key,
        label: RELEASE_MONTH_FORMATTER.format(parsed),
      };
      releaseMonthCache.set(key, monthInfo);
      return monthInfo;
    }
  }

  const yearMatch = /^(\d{4})$/.exec(date);
  if (yearMatch) {
    return {
      key: `${yearMatch[1]}-00`,
      label: `${yearMatch[1]} (month unspecified)`,
    };
  }

  return UNKNOWN_MONTH;
}

/**
 * Groups releases without re-sorting them. Group order and release order both
 * follow the input, allowing the caller's newest/oldest/artist sort to remain
 * authoritative.
 */
export function groupReleasesByMonth<T extends ReleaseDateLike>(
  releases: readonly T[],
): ReleaseMonthGroup<T>[] {
  const groups = new Map<string, ReleaseMonthGroup<T>>();

  for (const release of releases) {
    const month = releaseMonth(release.release_date);
    const existing = groups.get(month.key);
    if (existing) {
      existing.releases.push(release);
    } else {
      groups.set(month.key, { ...month, releases: [release] });
    }
  }

  return Array.from(groups.values());
}
