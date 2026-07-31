"use client";
/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */

import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Columns3,
  Ellipsis,
  ExternalLink,
  ListEnd,
  ListMusic,
  ListPlus,
  LoaderCircle,
  LogOut,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  preferredSpotifyImage,
  type NormalizedSpotifyTrack,
  type NormalizedSpotifyUserReference,
  type SpotifyImage,
} from "@/lib/spotify-data";
import {
  clearCachedReleaseScan,
  loadCachedReleaseScan,
  releaseCacheIsFresh,
  writeCachedReleaseBatch,
  writeCachedReleaseSnapshot,
} from "@/lib/release-cache";
import {
  groupReleasesByMonth,
  type Release,
  type ReleaseBatch,
  type ReleaseScanSnapshot,
} from "@/lib/release-data";
import { spotifyAppHref } from "@/lib/spotify-links";
import { PlaybackProvider, usePlayback } from "./spotify-player";

type User = {
  id: string;
  display_name: string | null;
  images?: Array<{ url: string }> | null;
};
type Playlist = {
  id: string;
  name: string;
  collaborative: boolean;
  public: boolean | null;
  snapshot_id: string;
  images?: Array<{ url: string }> | null;
  external_urls: { spotify: string };
  itemCount: number;
};
type PlaylistItem = {
  key: string;
  originalIndex: number;
  position: number;
  added_at: string | null;
  added_by?: NormalizedSpotifyUserReference | null;
  is_local: boolean;
  item: NormalizedSpotifyTrack;
};
type ReleaseSelectionTrack = {
  id: string;
  uri: string;
  name: string;
  artists: Array<{ id?: string; name: string }>;
  albumId: string;
  albumUri: string;
  discNumber?: number;
  trackNumber?: number;
};
type ColumnId =
  | "position"
  | "track"
  | "artist"
  | "album"
  | "duration"
  | "release"
  | "added"
  | "trackNumber"
  | "discNumber"
  | "explicit"
  | "itemType"
  | "local"
  | "trackLocal"
  | "playable"
  | "restriction"
  | "addedBy"
  | "addedByUri"
  | "addedByHref"
  | "addedByType"
  | "addedBySpotifyUrl"
  | "releasePrecision"
  | "albumType"
  | "albumObjectType"
  | "albumTotalTracks"
  | "albumArtists"
  | "albumCover"
  | "albumImageUrls"
  | "albumImageWidths"
  | "albumImageHeights"
  | "albumRestriction"
  | "trackId"
  | "trackUri"
  | "trackHref"
  | "trackSpotifyUrl"
  | "previewUrl"
  | "isrc"
  | "ean"
  | "upc"
  | "artistIds"
  | "artistUris"
  | "artistHrefs"
  | "artistTypes"
  | "artistSpotifyUrls"
  | "albumArtistIds"
  | "albumArtistUris"
  | "albumArtistHrefs"
  | "albumArtistTypes"
  | "albumArtistSpotifyUrls"
  | "albumId"
  | "albumUri"
  | "albumHref"
  | "albumSpotifyUrl";

type ColumnGroup =
  | "Essentials"
  | "Track"
  | "Playlist"
  | "Album"
  | "Identifiers"
  | "Links";
type SortValue = string | number | boolean | null | undefined;
type TrackColumn = {
  id: ColumnId;
  label: string;
  sortLabel?: string;
  group: ColumnGroup;
  defaultVisible?: boolean;
  required?: boolean;
  className?: string;
  getSortValue?: (entry: PlaylistItem) => SortValue;
  render: (entry: PlaylistItem, displayIndex: number) => ReactNode;
};

const releaseMemoryCache = new Map<string, ReleaseScanSnapshot>();
const EMPTY_VALUE = "\u2014";
const COLUMN_STORAGE_KEY = "taditech-playlist-columns-v1";
const RECENT_PLAYLIST_STORAGE_KEY = "taditech-recent-playlist-destinations-v1";
const MAX_RECENT_PLAYLISTS = 12;
const INITIAL_RELEASE_RENDER_LIMIT = 48;
const RELEASE_RENDER_BATCH_SIZE = 48;
const MAX_RELEASE_SELECTION = 20;
const PLAYLIST_ADD_CHUNK_SIZE = 100;

function freshReleaseSnapshot(snapshot?: ReleaseScanSnapshot) {
  return snapshot && releaseCacheIsFresh([snapshot], snapshot.complete)
    ? snapshot
    : undefined;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "The request failed.");
  return data;
}

function formatDuration(ms = 0) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatDate(date?: string | null) {
  if (!date) return EMPTY_VALUE;
  const dateOnly = /^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(date);
  const normalized =
    date.length === 4
      ? `${date}-01-01`
      : date.length === 7
        ? `${date}-01`
        : date;
  const parsed = new Date(dateOnly ? `${normalized}T00:00:00Z` : normalized);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  }).format(parsed);
}

function formatReleaseDate(date?: string | null, precision?: string) {
  if (!date) return EMPTY_VALUE;
  if (precision === "year" || date.length === 4) return date;
  if (precision === "month" || date.length === 7) {
    const parsed = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return date;
    return new Intl.DateTimeFormat("en", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }
  return formatDate(date);
}

function formatCheckedAt(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function displayText(value?: string | null) {
  return value?.trim() || EMPTY_VALUE;
}

function displayNumber(value?: number) {
  return value === undefined ? EMPTY_VALUE : String(value);
}

function displayBoolean(value?: boolean) {
  return value === undefined ? EMPTY_VALUE : value ? "Yes" : "No";
}

function metadataCode(value?: string | null) {
  if (!value?.trim()) return EMPTY_VALUE;
  return <code className="metadata-code" title={value}>{value}</code>;
}

function spotifyTrackUri(track: NormalizedSpotifyTrack) {
  return track.uri.startsWith("spotify:unavailable:") ? undefined : track.uri;
}

function joinedValues(values?: Array<string | undefined>) {
  const joined = values?.filter((value): value is string => Boolean(value)).join(", ");
  return joined || undefined;
}

function imageDimensions(
  images: SpotifyImage[],
  key: "height" | "width",
) {
  if (!images.length) return undefined;
  return images
    .map((image) => {
      const value = image[key];
      return value === null ? "Unknown" : value === undefined ? EMPTY_VALUE : String(value);
    })
    .join(", ");
}

function renderArtists(artists?: NormalizedSpotifyTrack["artists"]) {
  if (!artists?.length) return EMPTY_VALUE;
  return artists.map((artist, index) => {
    const spotifyHref = spotifyAppHref({
      uri: artist.uri,
      kind: "artist",
      id: artist.id,
      webUrl: artist.external_urls?.spotify,
    });
    return (
      <span key={`${artist.id || artist.name}:${index}`}>
        {index > 0 ? ", " : ""}
        {spotifyHref ? (
          <a href={spotifyHref} title="Open artist in Spotify app">
            {artist.name}
          </a>
        ) : artist.name}
      </span>
    );
  });
}

const TRACK_COLUMNS: TrackColumn[] = [
  {
    id: "albumCover",
    label: "Album cover",
    group: "Essentials",
    defaultVisible: true,
    required: true,
    className: "album-cover-cell",
    render: (entry) => {
      const cover = preferredSpotifyImage(entry.item.album?.images);
      return cover ? (
        <img
          alt=""
          className="album-cover"
          decoding="async"
          loading="lazy"
          src={cover}
        />
      ) : EMPTY_VALUE;
    },
  },
  {
    id: "position",
    label: "#",
    sortLabel: "Playlist position",
    group: "Essentials",
    defaultVisible: true,
    required: true,
    getSortValue: (entry) => entry.position,
    render: (_entry, displayIndex) => displayIndex + 1,
  },
  {
    id: "track",
    label: "Track",
    sortLabel: "Track name",
    group: "Essentials",
    defaultVisible: true,
    required: true,
    className: "track-title",
    getSortValue: (entry) => entry.item.name.toLocaleLowerCase(),
    render: (entry) => {
      const spotifyHref = spotifyAppHref({
        uri: entry.item.uri,
        webUrl: entry.item.external_urls?.spotify,
      });
      return (
        <>
          {spotifyHref ? (
            <a href={spotifyHref} title="Open track in Spotify app">
              {entry.item.name}
            </a>
          ) : entry.item.name}
          {entry.item.explicit && <span className="explicit">E</span>}
        </>
      );
    },
  },
  {
    id: "artist",
    label: "Artists",
    group: "Essentials",
    defaultVisible: true,
    getSortValue: (entry) =>
      entry.item.artists?.map((artist) => artist.name).join(", ").toLocaleLowerCase(),
    render: (entry) => renderArtists(entry.item.artists),
  },
  {
    id: "album",
    label: "Album",
    group: "Essentials",
    defaultVisible: true,
    getSortValue: (entry) => entry.item.album?.name.toLocaleLowerCase(),
    render: (entry) => {
      const album = entry.item.album;
      if (!album) return EMPTY_VALUE;
      const spotifyHref = spotifyAppHref({
        uri: album.uri,
        kind: "album",
        id: album.id,
        webUrl: album.external_urls?.spotify,
      });
      return spotifyHref ? (
        <a href={spotifyHref} title="Open album in Spotify app">
          {album.name}
        </a>
      ) : album.name;
    },
  },
  {
    id: "duration",
    label: "Time",
    sortLabel: "Duration",
    group: "Essentials",
    defaultVisible: true,
    getSortValue: (entry) => entry.item.duration_ms,
    render: (entry) =>
      entry.item.duration_ms === undefined
        ? EMPTY_VALUE
        : formatDuration(entry.item.duration_ms),
  },
  {
    id: "release",
    label: "Released",
    sortLabel: "Release date",
    group: "Essentials",
    defaultVisible: true,
    getSortValue: (entry) => entry.item.album?.release_date,
    render: (entry) =>
      formatReleaseDate(
        entry.item.album?.release_date,
        entry.item.album?.release_date_precision,
      ),
  },
  {
    id: "added",
    label: "Added",
    sortLabel: "Date added",
    group: "Essentials",
    defaultVisible: true,
    getSortValue: (entry) => entry.added_at,
    render: (entry) => formatDate(entry.added_at),
  },
  {
    id: "trackNumber",
    label: "Track no.",
    group: "Track",
    getSortValue: (entry) => entry.item.track_number,
    render: (entry) => displayNumber(entry.item.track_number),
  },
  {
    id: "discNumber",
    label: "Disc no.",
    group: "Track",
    getSortValue: (entry) => entry.item.disc_number,
    render: (entry) => displayNumber(entry.item.disc_number),
  },
  {
    id: "explicit",
    label: "Explicit",
    group: "Track",
    getSortValue: (entry) => entry.item.explicit,
    render: (entry) => displayBoolean(entry.item.explicit),
  },
  {
    id: "itemType",
    label: "Item type",
    group: "Track",
    getSortValue: (entry) => entry.item.type,
    render: (entry) => titleCase(entry.item.type),
  },
  {
    id: "playable",
    label: "Playable",
    group: "Track",
    getSortValue: (entry) => entry.item.is_playable,
    render: (entry) => displayBoolean(entry.item.is_playable),
  },
  {
    id: "trackLocal",
    label: "Track local flag",
    group: "Track",
    getSortValue: (entry) => entry.item.is_local,
    render: (entry) => displayBoolean(entry.item.is_local),
  },
  {
    id: "restriction",
    label: "Restriction",
    group: "Track",
    getSortValue: (entry) => entry.item.restrictions?.reason,
    render: (entry) =>
      entry.item.restrictions?.reason
        ? titleCase(entry.item.restrictions.reason)
        : EMPTY_VALUE,
  },
  {
    id: "local",
    label: "Local",
    group: "Playlist",
    getSortValue: (entry) => entry.is_local,
    render: (entry) => displayBoolean(entry.is_local),
  },
  {
    id: "addedBy",
    label: "Added by",
    group: "Playlist",
    getSortValue: (entry) => entry.added_by?.id,
    render: (entry) => {
      const addedBy = entry.added_by;
      if (!addedBy?.id) return EMPTY_VALUE;
      const spotifyHref = spotifyAppHref({
        uri: addedBy.uri,
        kind: "user",
        id: addedBy.id,
        webUrl: addedBy.external_urls?.spotify,
      });
      return spotifyHref ? (
        <a href={spotifyHref} title="Open profile in Spotify app">
          {addedBy.id}
        </a>
      ) : metadataCode(addedBy.id);
    },
  },
  {
    id: "addedByUri",
    label: "Added-by URI",
    group: "Playlist",
    getSortValue: (entry) => entry.added_by?.uri,
    render: (entry) => metadataCode(entry.added_by?.uri),
  },
  {
    id: "addedByType",
    label: "Added-by type",
    group: "Playlist",
    getSortValue: (entry) => entry.added_by?.type,
    render: (entry) =>
      entry.added_by?.type ? titleCase(entry.added_by.type) : EMPTY_VALUE,
  },
  {
    id: "releasePrecision",
    label: "Date precision",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.release_date_precision,
    render: (entry) => {
      const precision = entry.item.album?.release_date_precision;
      return precision ? titleCase(precision) : EMPTY_VALUE;
    },
  },
  {
    id: "albumType",
    label: "Album type",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.album_type,
    render: (entry) => {
      const type = entry.item.album?.album_type;
      return type ? titleCase(type) : EMPTY_VALUE;
    },
  },
  {
    id: "albumObjectType",
    label: "Album object type",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.type,
    render: (entry) => {
      const type = entry.item.album?.type;
      return type ? titleCase(type) : EMPTY_VALUE;
    },
  },
  {
    id: "albumTotalTracks",
    label: "Album tracks",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.total_tracks,
    render: (entry) => displayNumber(entry.item.album?.total_tracks),
  },
  {
    id: "albumArtists",
    label: "Album artists",
    group: "Album",
    getSortValue: (entry) =>
      entry.item.album?.artists
        ?.map((artist) => artist.name)
        .join(", ")
        .toLocaleLowerCase(),
    render: (entry) => renderArtists(entry.item.album?.artists),
  },
  {
    id: "albumImageUrls",
    label: "Album image URLs",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.images.map((image) => image.url).join(", "),
    render: (entry) =>
      metadataCode(entry.item.album?.images.map((image) => image.url).join(", ")),
  },
  {
    id: "albumImageWidths",
    label: "Image widths",
    group: "Album",
    getSortValue: (entry) =>
      entry.item.album ? imageDimensions(entry.item.album.images, "width") : undefined,
    render: (entry) =>
      displayText(
        entry.item.album
          ? imageDimensions(entry.item.album.images, "width")
          : undefined,
      ),
  },
  {
    id: "albumImageHeights",
    label: "Image heights",
    group: "Album",
    getSortValue: (entry) =>
      entry.item.album ? imageDimensions(entry.item.album.images, "height") : undefined,
    render: (entry) =>
      displayText(
        entry.item.album
          ? imageDimensions(entry.item.album.images, "height")
          : undefined,
      ),
  },
  {
    id: "albumRestriction",
    label: "Album restriction",
    group: "Album",
    getSortValue: (entry) => entry.item.album?.restrictions?.reason,
    render: (entry) => {
      const reason = entry.item.album?.restrictions?.reason;
      return reason ? titleCase(reason) : EMPTY_VALUE;
    },
  },
  {
    id: "trackId",
    label: "Track ID",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.id,
    render: (entry) => metadataCode(entry.item.id),
  },
  {
    id: "trackUri",
    label: "Track URI",
    group: "Identifiers",
    getSortValue: (entry) => spotifyTrackUri(entry.item),
    render: (entry) => metadataCode(spotifyTrackUri(entry.item)),
  },
  {
    id: "trackHref",
    label: "Track API URL",
    group: "Links",
    getSortValue: (entry) => entry.item.href,
    render: (entry) => metadataCode(entry.item.href),
  },
  {
    id: "isrc",
    label: "ISRC",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.external_ids?.isrc,
    render: (entry) => metadataCode(entry.item.external_ids?.isrc),
  },
  {
    id: "ean",
    label: "EAN",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.external_ids?.ean,
    render: (entry) => metadataCode(entry.item.external_ids?.ean),
  },
  {
    id: "upc",
    label: "UPC",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.external_ids?.upc,
    render: (entry) => metadataCode(entry.item.external_ids?.upc),
  },
  {
    id: "artistIds",
    label: "Artist IDs",
    group: "Identifiers",
    getSortValue: (entry) =>
      entry.item.artists?.map((artist) => artist.id).filter(Boolean).join(", "),
    render: (entry) =>
      metadataCode(
        entry.item.artists?.map((artist) => artist.id).filter(Boolean).join(", "),
      ),
  },
  {
    id: "artistUris",
    label: "Artist URIs",
    group: "Identifiers",
    getSortValue: (entry) =>
      entry.item.artists?.map((artist) => artist.uri).filter(Boolean).join(", "),
    render: (entry) =>
      metadataCode(
        entry.item.artists?.map((artist) => artist.uri).filter(Boolean).join(", "),
      ),
  },
  {
    id: "artistTypes",
    label: "Artist types",
    group: "Identifiers",
    getSortValue: (entry) =>
      joinedValues(entry.item.artists?.map((artist) => artist.type)),
    render: (entry) =>
      metadataCode(joinedValues(entry.item.artists?.map((artist) => artist.type))),
  },
  {
    id: "albumArtistIds",
    label: "Album artist IDs",
    group: "Identifiers",
    getSortValue: (entry) =>
      entry.item.album?.artists
        ?.map((artist) => artist.id)
        .filter(Boolean)
        .join(", "),
    render: (entry) =>
      metadataCode(
        entry.item.album?.artists
          ?.map((artist) => artist.id)
          .filter(Boolean)
          .join(", "),
      ),
  },
  {
    id: "albumArtistUris",
    label: "Album artist URIs",
    group: "Identifiers",
    getSortValue: (entry) =>
      entry.item.album?.artists
        ?.map((artist) => artist.uri)
        .filter(Boolean)
        .join(", "),
    render: (entry) =>
      metadataCode(
        entry.item.album?.artists
          ?.map((artist) => artist.uri)
          .filter(Boolean)
          .join(", "),
      ),
  },
  {
    id: "albumArtistTypes",
    label: "Album artist types",
    group: "Identifiers",
    getSortValue: (entry) =>
      joinedValues(entry.item.album?.artists?.map((artist) => artist.type)),
    render: (entry) =>
      metadataCode(
        joinedValues(entry.item.album?.artists?.map((artist) => artist.type)),
      ),
  },
  {
    id: "albumId",
    label: "Album ID",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.album?.id,
    render: (entry) => metadataCode(entry.item.album?.id),
  },
  {
    id: "albumUri",
    label: "Album URI",
    group: "Identifiers",
    getSortValue: (entry) => entry.item.album?.uri,
    render: (entry) => metadataCode(entry.item.album?.uri),
  },
  {
    id: "albumHref",
    label: "Album API URL",
    group: "Links",
    getSortValue: (entry) => entry.item.album?.href,
    render: (entry) => metadataCode(entry.item.album?.href),
  },
  {
    id: "trackSpotifyUrl",
    label: "Track Spotify URL",
    group: "Links",
    getSortValue: (entry) => entry.item.external_urls?.spotify,
    render: (entry) => metadataCode(entry.item.external_urls?.spotify),
  },
  {
    id: "previewUrl",
    label: "Preview URL (legacy)",
    group: "Links",
    getSortValue: (entry) => entry.item.preview_url,
    render: (entry) => metadataCode(entry.item.preview_url),
  },
  {
    id: "artistHrefs",
    label: "Artist API URLs",
    group: "Links",
    getSortValue: (entry) =>
      joinedValues(entry.item.artists?.map((artist) => artist.href)),
    render: (entry) =>
      metadataCode(joinedValues(entry.item.artists?.map((artist) => artist.href))),
  },
  {
    id: "artistSpotifyUrls",
    label: "Artist Spotify URLs",
    group: "Links",
    getSortValue: (entry) =>
      joinedValues(
        entry.item.artists?.map((artist) => artist.external_urls?.spotify),
      ),
    render: (entry) =>
      metadataCode(
        joinedValues(
          entry.item.artists?.map((artist) => artist.external_urls?.spotify),
        ),
      ),
  },
  {
    id: "albumSpotifyUrl",
    label: "Album Spotify URL",
    group: "Links",
    getSortValue: (entry) => entry.item.album?.external_urls?.spotify,
    render: (entry) => metadataCode(entry.item.album?.external_urls?.spotify),
  },
  {
    id: "albumArtistHrefs",
    label: "Album artist API URLs",
    group: "Links",
    getSortValue: (entry) =>
      joinedValues(entry.item.album?.artists?.map((artist) => artist.href)),
    render: (entry) =>
      metadataCode(
        joinedValues(entry.item.album?.artists?.map((artist) => artist.href)),
      ),
  },
  {
    id: "albumArtistSpotifyUrls",
    label: "Album artist Spotify URLs",
    group: "Links",
    getSortValue: (entry) =>
      joinedValues(
        entry.item.album?.artists?.map(
          (artist) => artist.external_urls?.spotify,
        ),
      ),
    render: (entry) =>
      metadataCode(
        joinedValues(
          entry.item.album?.artists?.map(
            (artist) => artist.external_urls?.spotify,
          ),
        ),
      ),
  },
  {
    id: "addedByHref",
    label: "Added-by API URL",
    group: "Links",
    getSortValue: (entry) => entry.added_by?.href,
    render: (entry) => metadataCode(entry.added_by?.href),
  },
  {
    id: "addedBySpotifyUrl",
    label: "Added-by Spotify URL",
    group: "Links",
    getSortValue: (entry) => entry.added_by?.external_urls?.spotify,
    render: (entry) => metadataCode(entry.added_by?.external_urls?.spotify),
  },
];

const DEFAULT_COLUMN_IDS = TRACK_COLUMNS
  .filter((column) => column.defaultVisible)
  .map((column) => column.id);
const VALID_COLUMN_IDS = new Set(TRACK_COLUMNS.map((column) => column.id));
const COLUMN_GROUPS: ColumnGroup[] = [
  "Essentials",
  "Track",
  "Playlist",
  "Album",
  "Identifiers",
  "Links",
];

function normalizeVisibleColumnIds(value: unknown): ColumnId[] {
  const requested = Array.isArray(value)
    ? new Set(
        value.filter(
          (column): column is ColumnId =>
            typeof column === "string" && VALID_COLUMN_IDS.has(column as ColumnId),
        ),
      )
    : new Set(DEFAULT_COLUMN_IDS);

  return TRACK_COLUMNS
    .filter((column) => column.required || requested.has(column.id))
    .map((column) => column.id);
}

function Landing({ authError }: { authError: string }) {
  return (
    <main className="landing">
      <section className="hero">
        <div>
          <div className="eyebrow">Your listening, in focus</div>
          <h1>
            Never miss
            <br />
            what drops <em>next.</em>
          </h1>
          <p className="hero-copy">
            One focused view for the newest releases from every artist you follow,
            plus a precision desk for sorting the playlists you own and collaborate on.
          </p>
          {authError && (
            <p style={{ color: "var(--coral)", fontSize: 13 }}>
              {authError === "missing_config"
                ? "Add your Spotify v2 Client ID to .env.local before connecting."
                : "Spotify could not complete the sign-in. Please try again."}
            </p>
          )}
          <a className="primary-button" href="/api/auth/login">
            Connect Spotify <ArrowRight size={16} />
          </a>
        </div>
        <div className="hero-demo" aria-hidden="true">
          <div className="demo-inner">
            <div className="demo-toolbar">
              <div className="demo-dots"><i /><i /><i /></div>
              <span>Release radar / live</span>
            </div>
            {[
              ["one", "Glasshouse", "Mira Vale", "Today"],
              ["two", "Night Signal", "Small Hours", "2d ago"],
              ["three", "Soft Geometry", "Ada North", "4d ago"],
            ].map(([cover, title, artist, date]) => (
              <div className="demo-release" key={title}>
                <div className={`fake-cover ${cover}`} />
                <div><strong>{title}</strong><small>{artist} · Single</small></div>
                <time>{date}</time>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="feature-strip">
        <div className="feature">
          <span className="feature-number">01</span>
          <h3>Followed-artist radar</h3>
          <p>Albums, EPs and singles from the artists you already care about, newest first.</p>
        </div>
        <div className="feature">
          <span className="feature-number">02</span>
          <h3>Every editable playlist</h3>
          <p>Your own and collaborative playlists, including private ones you grant access to.</p>
        </div>
        <div className="feature">
          <span className="feature-number">03</span>
          <h3>Sort, inspect, commit</h3>
          <p>Sort by useful track metadata, preview the result, then write that order back to Spotify.</p>
        </div>
      </section>
      <p className="legal-note">
        Spotify account required. Album art and metadata link directly back to Spotify.
        Tadi Tech is an independent companion and is not affiliated with Spotify.
      </p>
    </main>
  );
}

function ReleaseCard({
  release,
  selected,
  onToggle,
}: {
  release: Release;
  selected: boolean;
  onToggle: () => void;
}) {
  const playback = usePlayback();
  const playbackKey = `album:${release.id}`;
  const coverUrl = preferredSpotifyImage(release.images);
  const spotifyHref =
    spotifyAppHref({
      kind: "album",
      id: release.id,
      webUrl: release.external_urls.spotify,
    }) ?? release.external_urls.spotify;

  return (
    <article
      className={`release-card ${selected ? "selected" : ""}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("a, button, input, label")) return;
        onToggle();
      }}
    >
      <div className="cover-wrap">
        {coverUrl && (
          <img alt="" decoding="async" loading="lazy" src={coverUrl} />
        )}
        <label
          className="release-selector"
          onClick={(event) => event.stopPropagation()}
          title={selected ? "Remove from selection" : "Select release"}
        >
          <input
            aria-label={`${selected ? "Deselect" : "Select"} ${release.name}`}
            checked={selected}
            onChange={onToggle}
            type="checkbox"
          />
          <span aria-hidden="true">
            {selected && <Check size={14} strokeWidth={3} />}
          </span>
        </label>
      </div>
      <div className="release-actions">
        <span className="release-badge">{release.album_type}</span>
        <div className="release-action-buttons">
          <button
            aria-label={`Play ${release.name} in this browser`}
            disabled={!playback.deviceReady || Boolean(playback.pendingKey)}
            onClick={() =>
              void playback.play(
                { contextUri: `spotify:album:${release.id}` },
                playbackKey,
              )
            }
            title={
              playback.authorized
                ? "Play in browser"
                : "Reconnect Spotify to enable browser playback"
            }
            type="button"
          >
            {playback.pendingKey === playbackKey
              ? <LoaderCircle className="spinner" size={16} />
              : <Play size={16} fill="currentColor" />}
          </button>
          <a
            aria-label={`Open ${release.name} in the Spotify app`}
            href={spotifyHref}
            title="Open in Spotify app"
          >
            <ExternalLink size={15} />
          </a>
        </div>
      </div>
      <h3>
        <a href={spotifyHref} title="Open in Spotify app">
          {release.name}
        </a>
      </h3>
      <p>{release.artists.map((artist) => artist.name).join(", ")}</p>
      <div className="release-meta">
        <span>
          {formatReleaseDate(
            release.release_date,
            release.release_date_precision,
          )}
        </span>
        <span>{release.total_tracks} track{release.total_tracks === 1 ? "" : "s"}</span>
      </div>
    </article>
  );
}

function ReleasesView({ userId }: { userId: string }) {
  const playback = usePlayback();
  const initialSnapshot = freshReleaseSnapshot(releaseMemoryCache.get(userId));
  const [releases, setReleases] = useState<Release[]>(
    () => initialSnapshot?.releases ?? [],
  );
  const [artistCount, setArtistCount] = useState<number | null>(
    () => initialSnapshot?.artistCount ?? null,
  );
  const [scannedArtists, setScannedArtists] = useState(
    () => initialSnapshot?.scannedArtists ?? 0,
  );
  const [scanComplete, setScanComplete] = useState(
    () => initialSnapshot?.complete ?? false,
  );
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(
    () => initialSnapshot?.fetchedAt ?? null,
  );
  const [restoringCache, setRestoringCache] = useState(!initialSnapshot);
  const [restoredFromCache, setRestoredFromCache] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionError, setSelectionError] = useState("");
  const [bulkPending, setBulkPending] = useState<"queue" | "playlist" | "">("");
  const [bulkProgress, setBulkProgress] = useState({ complete: 0, total: 0 });
  const [bulkPlaylistOpen, setBulkPlaylistOpen] = useState(false);
  const [bulkPlaylists, setBulkPlaylists] = useState<Playlist[]>([]);
  const [bulkPlaylistsLoading, setBulkPlaylistsLoading] = useState(false);
  const [bulkDestinationId, setBulkDestinationId] = useState("");
  const [toast, setToast] = useState("");
  const [releaseRenderLimit, setReleaseRenderLimit] = useState(
    INITIAL_RELEASE_RENDER_LIMIT,
  );
  const scanController = useRef<AbortController | null>(null);
  const releaseLoadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const memorySnapshot = releaseMemoryCache.get(userId);
    if (freshReleaseSnapshot(memorySnapshot)) {
      setRestoringCache(false);
      return;
    }
    if (memorySnapshot) releaseMemoryCache.delete(userId);

    let cancelled = false;
    setRestoringCache(true);
    void loadCachedReleaseScan(userId)
      .then((snapshot) => {
        if (cancelled || !snapshot) return;
        releaseMemoryCache.set(userId, snapshot);
        startTransition(() => {
          setReleases(snapshot.releases);
          setArtistCount(snapshot.artistCount);
          setScannedArtists(snapshot.scannedArtists);
          setScanComplete(snapshot.complete);
          setLastCheckedAt(snapshot.fetchedAt);
          setRestoredFromCache(true);
        });
      })
      .finally(() => {
        if (!cancelled) setRestoringCache(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const scan = useCallback(async () => {
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;
    setPaused(false);

    const storedSnapshot = releaseMemoryCache.get(userId);
    const previousSnapshot = freshReleaseSnapshot(storedSnapshot);
    if (storedSnapshot && !previousSnapshot) {
      releaseMemoryCache.delete(userId);
    }
    const resumable =
      previousSnapshot &&
      !previousSnapshot.complete &&
      previousSnapshot.nextCursor
        ? previousSnapshot
        : undefined;
    const freshScan = !resumable;
    const merged = new Map(
      (resumable?.releases ?? []).map((release) => [release.id, release]),
    );
    let cursor = resumable?.nextCursor ?? null;
    let scanned = resumable?.scannedArtists ?? 0;
    let total = resumable?.artistCount ?? null;
    let receivedBatch = false;

    if (!resumable) {
      if (storedSnapshot && !previousSnapshot) {
        setReleases([]);
        setLastCheckedAt(null);
        setRestoredFromCache(false);
      }
      setArtistCount(null);
      setScannedArtists(0);
      setScanComplete(false);
    } else {
      setReleases(resumable.releases);
      setArtistCount(resumable.artistCount);
      setScannedArtists(resumable.scannedArtists);
    }

    setLoading(true);
    setError("");

    try {
      while (true) {
        if (controller.signal.aborted) {
          throw new DOMException("The release scan was paused.", "AbortError");
        }
        const requestedCursor = cursor;
        const data = await getJson<ReleaseBatch>(
          requestedCursor
            ? `/api/releases?after=${encodeURIComponent(requestedCursor)}`
            : "/api/releases",
          { signal: controller.signal },
        );
        if (controller.signal.aborted) {
          throw new DOMException("The release scan was paused.", "AbortError");
        }

        const nextCursor = data.complete ? null : data.nextCursor;
        if (nextCursor && nextCursor === requestedCursor) {
          throw new Error("Spotify returned the same artist page twice. Continue the scan later.");
        }
        if (freshScan && !receivedBatch) {
          await clearCachedReleaseScan(userId);
        }
        await writeCachedReleaseBatch(userId, requestedCursor, data);
        receivedBatch = true;

        for (const release of data.releases) merged.set(release.id, release);
        scanned += data.scannedArtists;
        if (data.artistCount !== null) {
          total = Math.max(total ?? 0, data.artistCount, scanned);
        }

        const sorted = Array.from(merged.values()).sort((a, b) =>
          b.release_date.localeCompare(a.release_date),
        );
        if (!nextCursor && total === null) total = scanned;

        const snapshot: ReleaseScanSnapshot = {
          releases: sorted,
          artistCount: total,
          scannedArtists: scanned,
          nextCursor,
          complete: !nextCursor,
          fetchedAt: data.fetchedAt,
        };
        releaseMemoryCache.set(userId, snapshot);
        if (snapshot.complete) {
          await writeCachedReleaseSnapshot(userId, snapshot);
        }
        setReleases(sorted);
        setArtistCount(total);
        setScannedArtists(scanned);
        setScanComplete(snapshot.complete);
        setLastCheckedAt(snapshot.fetchedAt);
        setRestoredFromCache(false);

        if (!nextCursor) {
          setPaused(false);
          break;
        }
        cursor = nextCursor;
      }
    } catch (scanError) {
      if (freshScan && !receivedBatch && previousSnapshot) {
        setReleases(previousSnapshot.releases);
        setArtistCount(previousSnapshot.artistCount);
        setScannedArtists(previousSnapshot.scannedArtists);
        setScanComplete(previousSnapshot.complete);
        setLastCheckedAt(previousSnapshot.fetchedAt);
      }
      if (
        !(scanError instanceof DOMException && scanError.name === "AbortError")
      ) {
        setError(
          scanError instanceof Error ? scanError.message : "Could not scan releases.",
        );
      }
    } finally {
      if (scanController.current === controller) {
        scanController.current = null;
        setLoading(false);
      }
    }
  }, [userId]);

  const pauseScan = useCallback(() => {
    const activeScan = scanController.current;
    if (!activeScan) return;
    setPaused(true);
    setLoading(false);
    activeScan.abort();
  }, []);

  useEffect(() => () => scanController.current?.abort(), []);

  useEffect(() => {
    if (!bulkPlaylistOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !bulkPending) {
        setBulkPlaylistOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [bulkPending, bulkPlaylistOpen]);

  const showReleaseToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3600);
  }, []);

  const toggleReleaseSelection = (releaseId: string) => {
    const isSelected = selectedReleaseIds.has(releaseId);
    if (!isSelected && selectedReleaseIds.size >= MAX_RELEASE_SELECTION) {
      setSelectionError(
        `Choose up to ${MAX_RELEASE_SELECTION} releases per bulk action.`,
      );
      return;
    }
    setSelectionError("");
    setSelectedReleaseIds((current) => {
      const next = new Set(current);
      if (next.has(releaseId)) next.delete(releaseId);
      else next.add(releaseId);
      return next;
    });
  };

  const resolveSelectedReleaseTracks = async () => {
    const ids = Array.from(selectedReleaseIds);
    if (ids.length === 0) throw new Error("Choose at least one release.");
    const data = await getJson<{ tracks: ReleaseSelectionTrack[] }>(
      "/api/releases/tracks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      },
    );
    if (data.tracks.length === 0) {
      throw new Error("Spotify did not return any playable tracks for this selection.");
    }
    return data.tracks;
  };

  const addSelectedReleasesToQueue = async () => {
    if (bulkPending || selectedReleaseIds.size === 0) return;
    setBulkPending("queue");
    setSelectionError("");
    setBulkProgress({ complete: 0, total: 0 });
    try {
      const tracks = await resolveSelectedReleaseTracks();
      setBulkProgress({ complete: 0, total: tracks.length });
      for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index];
        const queued = await playback.queue(
          track.uri,
          `release-queue:${track.id}:${index}`,
        );
        if (!queued) {
          throw new Error(
            `Spotify stopped after ${index} of ${tracks.length} tracks. Start playback and try the remaining selection again.`,
          );
        }
        setBulkProgress({ complete: index + 1, total: tracks.length });
      }
      showReleaseToast(
        `Added ${tracks.length} track${tracks.length === 1 ? "" : "s"} to the queue.`,
      );
      setSelectedReleaseIds(new Set());
    } catch (bulkError) {
      setSelectionError(
        bulkError instanceof Error
          ? bulkError.message
          : "Could not add these releases to the queue.",
      );
    } finally {
      setBulkPending("");
      setBulkProgress({ complete: 0, total: 0 });
    }
  };

  const openBulkPlaylistDialog = async () => {
    if (bulkPending || selectedReleaseIds.size === 0) return;
    setBulkPlaylistOpen(true);
    setSelectionError("");
    if (bulkPlaylists.length > 0 || bulkPlaylistsLoading) return;
    setBulkPlaylistsLoading(true);
    try {
      const data = await getJson<{ playlists: Playlist[] }>("/api/playlists");
      setBulkPlaylists(data.playlists);
      setBulkDestinationId(data.playlists[0]?.id ?? "");
    } catch (playlistError) {
      setSelectionError(
        playlistError instanceof Error
          ? playlistError.message
          : "Could not load your editable playlists.",
      );
    } finally {
      setBulkPlaylistsLoading(false);
    }
  };

  const addSelectedReleasesToPlaylist = async () => {
    if (
      bulkPending ||
      selectedReleaseIds.size === 0 ||
      !bulkDestinationId
    ) {
      return;
    }
    setBulkPending("playlist");
    setSelectionError("");
    setBulkProgress({ complete: 0, total: 0 });
    try {
      const tracks = await resolveSelectedReleaseTracks();
      setBulkProgress({ complete: 0, total: tracks.length });
      let added = 0;
      for (
        let offset = 0;
        offset < tracks.length;
        offset += PLAYLIST_ADD_CHUNK_SIZE
      ) {
        const uris = tracks
          .slice(offset, offset + PLAYLIST_ADD_CHUNK_SIZE)
          .map((track) => track.uri);
        await getJson<{ snapshotId: string; added: number }>(
          `/api/playlists/${encodeURIComponent(bulkDestinationId)}/items`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uris }),
          },
        );
        added += uris.length;
        setBulkProgress({ complete: added, total: tracks.length });
      }
      const destination = bulkPlaylists.find(
        (playlist) => playlist.id === bulkDestinationId,
      );
      showReleaseToast(
        `Added ${tracks.length} track${tracks.length === 1 ? "" : "s"} to ${destination?.name ?? "the playlist"}.`,
      );
      setSelectedReleaseIds(new Set());
      setBulkPlaylistOpen(false);
    } catch (bulkError) {
      setSelectionError(
        bulkError instanceof Error
          ? bulkError.message
          : "Could not add these releases to the playlist.",
      );
    } finally {
      setBulkPending("");
      setBulkProgress({ complete: 0, total: 0 });
    }
  };

  const releaseGroups = useMemo(() => {
    const needle = query.toLowerCase();
    const filtered = releases.filter((release) =>
      `${release.name} ${release.artists.map((artist) => artist.name).join(" ")}`
        .toLowerCase()
        .includes(needle),
    );

    const compareReleases = (a: Release, b: Release) => {
      const dateOrder = b.release_date.localeCompare(a.release_date);
      const artistOrder = (a.artists[0]?.name ?? "").localeCompare(
        b.artists[0]?.name ?? "",
      );
      const titleOrder = a.name.localeCompare(b.name);

      if (sort === "oldest") return -dateOrder || artistOrder || titleOrder;
      if (sort === "artist") return artistOrder || dateOrder || titleOrder;
      if (sort === "title") return titleOrder || artistOrder || dateOrder;
      return dateOrder || artistOrder || titleOrder;
    };

    const groups = groupReleasesByMonth(filtered);
    for (const group of groups) group.releases.sort(compareReleases);
    groups.sort((a, b) => {
      if (a.key === "unknown") return b.key === "unknown" ? 0 : 1;
      if (b.key === "unknown") return -1;
      const monthOrder = a.key.localeCompare(b.key);
      return sort === "oldest" ? monthOrder : -monthOrder;
    });
    return groups;
  }, [query, releases, sort]);

  const visibleCount = releaseGroups.reduce(
    (count, group) => count + group.releases.length,
    0,
  );
  const renderedReleaseGroups = useMemo(() => {
    return releaseGroups.reduce<
      Array<(typeof releaseGroups)[number] & { totalReleases: number }>
    >((renderedGroups, group) => {
      const renderedCount = renderedGroups.reduce(
        (count, renderedGroup) => count + renderedGroup.releases.length,
        0,
      );
      const remaining = releaseRenderLimit - renderedCount;
      if (remaining <= 0) return renderedGroups;
      const visibleReleases = group.releases.slice(0, remaining);
      return [
        ...renderedGroups,
        {
          ...group,
          releases: visibleReleases,
          totalReleases: group.releases.length,
        },
      ];
    }, []);
  }, [releaseGroups, releaseRenderLimit]);
  const renderedReleaseCount = Math.min(releaseRenderLimit, visibleCount);
  const selectableRenderedReleaseIds = useMemo(
    () =>
      renderedReleaseGroups
        .flatMap((group) => group.releases.map((release) => release.id))
        .slice(0, MAX_RELEASE_SELECTION),
    [renderedReleaseGroups],
  );
  const renderedSelectionComplete =
    selectableRenderedReleaseIds.length > 0 &&
    selectableRenderedReleaseIds.every((id) => selectedReleaseIds.has(id));

  const toggleRenderedReleaseSelection = () => {
    setSelectionError("");
    setSelectedReleaseIds((current) => {
      const next = new Set(current);
      if (renderedSelectionComplete) {
        for (const id of selectableRenderedReleaseIds) next.delete(id);
        return next;
      }
      for (const id of selectableRenderedReleaseIds) {
        if (next.size >= MAX_RELEASE_SELECTION) break;
        next.add(id);
      }
      return next;
    });
    if (visibleCount > MAX_RELEASE_SELECTION && !renderedSelectionComplete) {
      setSelectionError(
        `Selected the first ${MAX_RELEASE_SELECTION} shown releases. Complete this action before selecting more.`,
      );
    }
  };

  useEffect(() => {
    if (renderedReleaseCount >= visibleCount) return;

    const loadNextBatch = () => {
      startTransition(() => {
        setReleaseRenderLimit((current) =>
          Math.min(current + RELEASE_RENDER_BATCH_SIZE, visibleCount),
        );
      });
    };
    const target = releaseLoadMoreRef.current;
    if (!target || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadNextBatch();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [renderedReleaseCount, visibleCount]);

  const hasProgress = scannedArtists > 0;
  const scanButtonLabel = restoringCache
    ? "Checking cache"
    : paused
      ? "Continue scan"
      : scanComplete
        ? "Scan again"
        : hasProgress
          ? "Continue scan"
          : "Check now";
  const progressKnown =
    scanComplete || (artistCount !== null && artistCount > 0);
  const progressPercent = scanComplete
    ? 100
    : artistCount !== null && artistCount > 0
      ? Math.min(100, Math.round((scannedArtists / artistCount) * 100))
      : 0;
  const showProgress =
    !restoringCache && (loading || paused || hasProgress || scanComplete);
  const progressStatus = loading
    ? "Scanning"
    : paused
      ? "Paused"
      : error
        ? "Interrupted"
        : restoredFromCache
          ? scanComplete
            ? "Saved scan"
            : "Saved partial scan"
          : scanComplete
            ? "Complete"
            : "Ready to continue";
  const lastCheckedLabel = formatCheckedAt(lastCheckedAt);
  const progressSummary =
    artistCount !== null && artistCount > 0
      ? `${scannedArtists} of ${artistCount} artists checked`
      : scanComplete
        ? "No followed artists found"
        : paused
          ? "Continue to load your followed-artist total"
          : "Loading your followed artists";

  return (
    <main className="main">
      <header className="page-heading">
        <div>
          <div className="eyebrow">Release radar</div>
          <h1>Fresh from your orbit.</h1>
        </div>
        <div className="stats">
          <div className="stat">
            <strong>
              {hasProgress && !scanComplete && artistCount !== null
                ? `${scannedArtists}/${artistCount}`
                : artistCount ?? "—"}
            </strong>
            <span>{scanComplete ? "artists scanned" : "artists"}</span>
          </div>
          <div className="stat"><strong>{releases.length || "—"}</strong><span>releases</span></div>
        </div>
      </header>
      <div className="toolbar">
        <label className="search">
          <Search size={15} color="var(--dim)" />
          <input
            aria-label="Search releases"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search artist or release"
            value={query}
          />
        </label>
        <div className="toolbar-actions">
          <select
            aria-label="Sort releases"
            className="sort-select"
            onChange={(event) => setSort(event.target.value)}
            value={sort}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="artist">Artist A–Z within months</option>
            <option value="title">Title A–Z within months</option>
          </select>
          {loading ? (
            <button
              className="secondary-button"
              onClick={pauseScan}
              type="button"
            >
              <Pause size={14} fill="currentColor" />
              Pause scan
            </button>
          ) : (
            <button
              className="secondary-button"
              disabled={restoringCache}
              onClick={() => void scan()}
              type="button"
            >
              {paused ? <Play size={14} fill="currentColor" /> : <RefreshCw size={14} />}
              {scanButtonLabel}
            </button>
          )}
        </div>
      </div>
      {visibleCount > 0 && (
        <section
          aria-label="Selected release actions"
          className={`release-selection-bar ${
            selectedReleaseIds.size > 0 ? "has-selection" : ""
          }`}
        >
          <div className="release-selection-copy">
            <strong>
              {selectedReleaseIds.size > 0
                ? `${selectedReleaseIds.size} release${selectedReleaseIds.size === 1 ? "" : "s"} selected`
                : "Select releases for a bulk action"}
            </strong>
            <span>
              Album tracks are loaded only when you add the selection somewhere.
            </span>
          </div>
          <div className="release-selection-actions">
            <button
              className="secondary-button"
              disabled={Boolean(bulkPending)}
              onClick={toggleRenderedReleaseSelection}
              type="button"
            >
              <Check size={14} />
              {renderedSelectionComplete ? "Deselect shown" : "Select shown"}
            </button>
            {selectedReleaseIds.size > 0 && (
              <button
                className="secondary-button"
                disabled={Boolean(bulkPending)}
                onClick={() => {
                  setSelectedReleaseIds(new Set());
                  setSelectionError("");
                }}
                type="button"
              >
                Clear
              </button>
            )}
            <button
              className="secondary-button"
              disabled={
                selectedReleaseIds.size === 0 ||
                Boolean(bulkPending) ||
                !playback.authorized
              }
              onClick={() => void addSelectedReleasesToQueue()}
              type="button"
            >
              {bulkPending === "queue"
                ? <LoaderCircle className="spinner" size={14} />
                : <ListEnd size={14} />}
              {bulkPending === "queue" && bulkProgress.total > 0
                ? `${bulkProgress.complete}/${bulkProgress.total}`
                : "Add to queue"}
            </button>
            <button
              className="primary-button"
              disabled={selectedReleaseIds.size === 0 || Boolean(bulkPending)}
              onClick={() => void openBulkPlaylistDialog()}
              type="button"
            >
              <ListPlus size={14} />
              Add to playlist
            </button>
          </div>
          {selectionError && (
            <p className="release-selection-error" role="alert">
              {selectionError}
            </p>
          )}
        </section>
      )}
      {showProgress && (
        <section className="scan-progress" aria-label="Release scan progress">
          <div className="scan-progress-head">
            <span>{progressStatus}</span>
            <strong>{progressKnown ? `${progressPercent}%` : "Starting…"}</strong>
          </div>
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={progressKnown ? progressPercent : undefined}
            aria-valuetext={
              progressKnown
                ? `${progressPercent}% complete`
                : paused
                  ? "Scan paused before the artist total was loaded"
                  : error
                    ? `${scannedArtists} artists checked; total unavailable`
                    : "Loading followed artists"
            }
            aria-label="Release scan progress"
            className={`scan-progress-track ${
              !progressKnown ? "unknown" : ""
            } ${loading && !progressKnown ? "indeterminate" : ""}`}
            role="progressbar"
          >
            <i style={progressKnown ? { width: `${progressPercent}%` } : undefined} />
          </div>
          <small>
            {progressSummary}
            {lastCheckedLabel ? ` · Last checked ${lastCheckedLabel}` : ""}
            {restoredFromCache ? " · Restored from this device" : ""}
          </small>
        </section>
      )}
      {restoringCache && (
        <div className="loading-state">
          <LoaderCircle className="spinner" size={26} />
          <div>
            <strong>Checking this device for a saved release scan</strong>
            <br />
            <small>No Spotify request is being sent.</small>
          </div>
        </div>
      )}
      {loading && (
        <div className="loading-state">
          <LoaderCircle className="spinner" size={26} />
          <div>
            <strong>
              {artistCount
                ? `Checked ${scannedArtists} of ${artistCount} followed artists`
                : "Finding the artists you follow"}
            </strong>
            <br />
            <small>
              Requests run one at a time and wait whenever Spotify asks us to slow down.
            </small>
          </div>
        </div>
      )}
      {!loading && error && (
        <div className="error-state">
          <span>{error}</span>
          <button className="secondary-button" onClick={() => void scan()}>
            {scanComplete ? "Scan again" : hasProgress ? "Continue scan" : "Try again"}
          </button>
        </div>
      )}
      {!restoringCache && !loading && !error && !scanComplete && (
        <div className="empty">
          {paused ? <Pause size={28} /> : <Sparkles size={28} />}
          <strong>
            {paused
              ? "Release scan paused."
              : hasProgress
                ? "Your partial scan is saved."
                : "Check when you're ready."}
          </strong>
          <span>
            {paused
              ? "No new batch starts until you continue. A Spotify request already in flight may finish."
              : hasProgress
                ? `Continue from artist ${scannedArtists + 1}; completed batches will not be fetched again.`
                : "No release requests are sent until you start the scan."}
          </span>
          <button className="primary-button" onClick={() => void scan()} type="button">
            {paused || hasProgress ? "Continue release scan" : "Check for new releases"}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {!restoringCache && !loading && !error && scanComplete && visibleCount === 0 && (
        <div className="empty">
          <Music2 size={28} />
          <span>
            {query ? "No releases match this search." : "No recent releases were found."}
          </span>
        </div>
      )}
      {visibleCount > 0 && (
        <div className="release-months">
          {renderedReleaseGroups.map((group, index) => {
            const headingId = `release-month-${group.key}`;
            return (
              <section
                aria-labelledby={headingId}
                className="release-month"
                key={group.key}
              >
                <header className="release-month-head">
                  <div className="release-month-title">
                    <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <h2 id={headingId}>{group.label}</h2>
                  </div>
                  <span>
                    {group.totalReleases} release
                    {group.totalReleases === 1 ? "" : "s"}
                  </span>
                </header>
                <div className="release-grid">
                  {group.releases.map((release) => (
                    <ReleaseCard
                      key={release.id}
                      onToggle={() => toggleReleaseSelection(release.id)}
                      release={release}
                      selected={selectedReleaseIds.has(release.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {renderedReleaseCount < visibleCount && (
            <div
              className="release-render-progress"
              ref={releaseLoadMoreRef}
              role="status"
            >
              <span>
                {visibleCount - renderedReleaseCount} more cached releases
              </span>
              <button
                className="secondary-button"
                onClick={() =>
                  setReleaseRenderLimit((current) =>
                    Math.min(
                      current + RELEASE_RENDER_BATCH_SIZE,
                      visibleCount,
                    ),
                  )
                }
                type="button"
              >
                Show more
              </button>
            </div>
          )}
        </div>
      )}
      {bulkPlaylistOpen && (
        <div
          className="track-action-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !bulkPending) {
              setBulkPlaylistOpen(false);
            }
          }}
        >
          <section
            aria-labelledby="release-playlist-title"
            aria-modal="true"
            className="track-action-dialog"
            role="dialog"
          >
            <header className="track-action-dialog-head">
              <div>
                <span>Selected releases</span>
                <h2 id="release-playlist-title">Add every track</h2>
                <p>
                  {selectedReleaseIds.size} release
                  {selectedReleaseIds.size === 1 ? "" : "s"} selected
                </p>
              </div>
              <button
                aria-label="Close playlist selection"
                disabled={Boolean(bulkPending)}
                onClick={() => setBulkPlaylistOpen(false)}
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <div className="track-action-playlist">
              <label htmlFor="release-destination-playlist">
                Destination playlist
              </label>
              {bulkPlaylistsLoading ? (
                <div className="release-playlist-loading" role="status">
                  <LoaderCircle className="spinner" size={16} />
                  Loading editable playlists
                </div>
              ) : bulkPlaylists.length === 0 ? (
                <div className="release-playlist-loading" role="status">
                  No owned or collaborative playlists were found.
                </div>
              ) : (
                <select
                  disabled={Boolean(bulkPending) || bulkPlaylists.length === 0}
                  id="release-destination-playlist"
                  onChange={(event) =>
                    setBulkDestinationId(event.target.value)
                  }
                  value={bulkDestinationId}
                >
                  {bulkPlaylists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="primary-button"
                disabled={
                  !bulkDestinationId ||
                  Boolean(bulkPending) ||
                  bulkPlaylistsLoading
                }
                onClick={() => void addSelectedReleasesToPlaylist()}
                type="button"
              >
                {bulkPending === "playlist"
                  ? <LoaderCircle className="spinner" size={15} />
                  : <ListPlus size={15} />}
                {bulkPending === "playlist" && bulkProgress.total > 0
                  ? `Adding ${bulkProgress.complete}/${bulkProgress.total}`
                  : "Add all tracks"}
              </button>
            </div>
            {selectionError && (
              <p className="track-action-error" role="alert">
                {selectionError}
              </p>
            )}
          </section>
        </div>
      )}
      <p className="legal-note">
        Metadata and cover art provided by Spotify. Open any release to view it on Spotify.
      </p>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}

function PlaylistsView() {
  const playback = usePlayback();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selected, setSelected] = useState<Playlist | null>(null);
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);
  const [error, setError] = useState("");
  const [playlistSidebarCollapsed, setPlaylistSidebarCollapsed] = useState(false);
  const [playlistQuery, setPlaylistQuery] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ColumnId>("position");
  const [descending, setDescending] = useState(false);
  const [toast, setToast] = useState("");
  const [actionItem, setActionItem] = useState<PlaylistItem | null>(null);
  const [actionPlaylistOnly, setActionPlaylistOnly] = useState(false);
  const [actionPlaylistQuery, setActionPlaylistQuery] = useState("");
  const [recentPlaylistIds, setRecentPlaylistIds] = useState<string[]>([]);
  const [songContextMenu, setSongContextMenu] = useState<{
    entry: PlaylistItem;
    x: number;
    y: number;
  } | null>(null);
  const [actionPending, setActionPending] = useState<"queue" | "playlist" | "">("");
  const [actionError, setActionError] = useState("");
  const [destinationPlaylistId, setDestinationPlaylistId] = useState("");
  const [loadedPlaylistId, setLoadedPlaylistId] = useState<string | null>(null);
  const [visibleColumnIds, setVisibleColumnIds] =
    useState<ColumnId[]>(DEFAULT_COLUMN_IDS);
  const itemLoadController = useRef<AbortController | null>(null);
  const selectedPlaylistId = selected?.id ?? null;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLUMN_STORAGE_KEY);
      if (saved) setVisibleColumnIds(normalizeVisibleColumnIds(JSON.parse(saved)));
    } catch {
      // A blocked or malformed device preference should not block the playlist table.
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(RECENT_PLAYLIST_STORAGE_KEY) ?? "[]",
      );
      if (Array.isArray(saved)) {
        setRecentPlaylistIds(
          saved
            .filter((id): id is string => typeof id === "string")
            .slice(0, MAX_RECENT_PLAYLISTS),
        );
      }
    } catch {
      // Recent destinations are only a convenience; an unavailable preference is safe.
    }
  }, []);

  const updateVisibleColumns = useCallback((value: ColumnId[]) => {
    const normalized = normalizeVisibleColumnIds(value);
    setVisibleColumnIds(normalized);
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // The selection still works for this session when storage is unavailable.
    }
  }, []);

  const visibleColumnSet = useMemo(
    () => new Set(visibleColumnIds),
    [visibleColumnIds],
  );
  const visibleColumns = useMemo(
    () => TRACK_COLUMNS.filter((column) => visibleColumnSet.has(column.id)),
    [visibleColumnSet],
  );
  const sortableColumns = useMemo(
    () => visibleColumns.filter((column) => column.getSortValue),
    [visibleColumns],
  );

  useEffect(() => {
    void (async () => {
      try {
        const data = await getJson<{ playlists: Playlist[] }>("/api/playlists");
        setPlaylists(data.playlists);
        if (data.playlists[0]) setSelected(data.playlists[0]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load playlists.");
      } finally {
        setLoadingLists(false);
      }
    })();
  }, []);

  const visiblePlaylists = useMemo(() => {
    const needle = playlistQuery.trim().toLocaleLowerCase();
    if (!needle) return playlists;
    return playlists.filter((playlist) =>
      playlist.name.toLocaleLowerCase().includes(needle),
    );
  }, [playlistQuery, playlists]);
  const selectedOutsideFilter = Boolean(
    playlistQuery.trim() &&
    selected &&
    !visiblePlaylists.some((playlist) => playlist.id === selected.id),
  );
  const recentPlaylistIdSet = useMemo(
    () => new Set(recentPlaylistIds),
    [recentPlaylistIds],
  );
  const orderedActionPlaylists = useMemo(() => {
    const recentRank = new Map(
      recentPlaylistIds.map((playlistId, index) => [playlistId, index]),
    );
    return playlists
      .map((playlist, index) => ({ playlist, index }))
      .sort((left, right) => {
        const leftRank = recentRank.get(left.playlist.id);
        const rightRank = recentRank.get(right.playlist.id);
        if (leftRank !== undefined || rightRank !== undefined) {
          if (leftRank === undefined) return 1;
          if (rightRank === undefined) return -1;
          return leftRank - rightRank;
        }
        return left.index - right.index;
      })
      .map(({ playlist }) => playlist);
  }, [playlists, recentPlaylistIds]);
  const filteredActionPlaylists = useMemo(() => {
    const needle = actionPlaylistQuery.trim().toLocaleLowerCase();
    if (!needle) return orderedActionPlaylists;
    return orderedActionPlaylists.filter((playlist) =>
      playlist.name.toLocaleLowerCase().includes(needle),
    );
  }, [actionPlaylistQuery, orderedActionPlaylists]);

  const loadItems = useCallback(async (playlist: Pick<Playlist, "id">) => {
    itemLoadController.current?.abort();
    const controller = new AbortController();
    itemLoadController.current = controller;
    setLoadingItems(true);
    setError("");
    setItems([]);
    setLoadedPlaylistId(null);
    try {
      const data = await getJson<{ items: Omit<PlaylistItem, "position">[] }>(
        `/api/playlists/${encodeURIComponent(playlist.id)}/items`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      setItems(data.items.map((item, position) => ({ ...item, position })));
      setLoadedPlaylistId(playlist.id);
      setSortKey("position");
      setDescending(false);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load this playlist.");
    } finally {
      if (itemLoadController.current === controller) {
        itemLoadController.current = null;
        setLoadingItems(false);
      }
    }
  }, []);

  useEffect(() => {
    if (selectedPlaylistId) void loadItems({ id: selectedPlaylistId });
  }, [loadItems, selectedPlaylistId]);

  useEffect(() => () => itemLoadController.current?.abort(), []);

  useEffect(() => {
    if (!actionItem) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !actionPending) setActionItem(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionItem, actionPending]);

  useEffect(() => {
    if (!songContextMenu) return;
    const closeMenu = () => setSongContextMenu(null);
    const closeOnKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", closeOnKey);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", closeOnKey);
    };
  }, [songContextMenu]);

  const visibleItems = useMemo(() => {
    const needle = query.toLowerCase();
    const filtered = items.filter((entry) =>
      `${entry.item.name} ${entry.item.artists?.map((artist) => artist.name).join(" ")} ${entry.item.album?.name || ""}`
        .toLowerCase()
        .includes(needle),
    );
    const sortColumn = TRACK_COLUMNS.find((column) => column.id === sortKey);
    return [...filtered].sort((a, b) => {
      const left = sortColumn?.getSortValue?.(a);
      const right = sortColumn?.getSortValue?.(b);
      const leftMissing = left === null || left === undefined || left === "";
      const rightMissing = right === null || right === undefined || right === "";
      if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;

      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : typeof left === "boolean" && typeof right === "boolean"
            ? Number(left) - Number(right)
            : String(left ?? "").localeCompare(String(right ?? ""));
      if (compared === 0) return a.position - b.position;
      return descending ? -compared : compared;
    });
  }, [descending, items, query, sortKey]);

  const sortBy = (key: ColumnId) => {
    if (sortKey === key) setDescending((current) => !current);
    else {
      setSortKey(key);
      setDescending(false);
    }
  };

  const toggleColumn = (column: TrackColumn) => {
    if (column.required) return;
    const isVisible = visibleColumnSet.has(column.id);
    updateVisibleColumns(
      isVisible
        ? visibleColumnIds.filter((id) => id !== column.id)
        : [...visibleColumnIds, column.id],
    );
    if (isVisible && sortKey === column.id) {
      setSortKey("position");
      setDescending(false);
    }
  };

  const resetColumns = () => {
    updateVisibleColumns(DEFAULT_COLUMN_IDS);
    if (!DEFAULT_COLUMN_IDS.includes(sortKey)) {
      setSortKey("position");
      setDescending(false);
    }
  };

  const showAllColumns = () => {
    updateVisibleColumns(TRACK_COLUMNS.map((column) => column.id));
  };

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const playPlaylistEntry = (entry: PlaylistItem, key: string) => {
    void playback.play(
      selected
        ? {
            contextUri: `spotify:playlist:${selected.id}`,
            offsetPosition: entry.position,
          }
        : { uris: [entry.item.uri] },
      key,
    );
  };

  const openTrackActions = (
    entry: PlaylistItem,
    playlistOnly = false,
  ) => {
    const recentDestination = recentPlaylistIds.find((playlistId) =>
      playlists.some((playlist) => playlist.id === playlistId),
    );
    setDestinationPlaylistId(
      recentDestination ?? selected?.id ?? playlists[0]?.id ?? "",
    );
    setActionPlaylistOnly(playlistOnly);
    setActionPlaylistQuery("");
    setActionPending("");
    setActionError("");
    setActionItem(entry);
  };

  const rememberPlaylistDestination = (playlistId: string) => {
    setRecentPlaylistIds((current) => {
      const next = [
        playlistId,
        ...current.filter((id) => id !== playlistId),
      ].slice(0, MAX_RECENT_PLAYLISTS);
      try {
        window.localStorage.setItem(
          RECENT_PLAYLIST_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Keep the in-memory order when local storage is unavailable.
      }
      return next;
    });
  };

  const addContextSongToQueue = async (entry: PlaylistItem) => {
    setSongContextMenu(null);
    const queued = await playback.queue(
      entry.item.uri,
      `context-queue:${entry.key}`,
    );
    if (queued) showToast(`Added “${entry.item.name}” to the queue.`);
  };

  const addActionItemToQueue = async () => {
    if (!actionItem || actionPending) return;
    setActionPending("queue");
    const queued = await playback.queue(
      actionItem.item.uri,
      `queue:${actionItem.key}`,
    );
    setActionPending("");
    if (!queued) {
      setActionError("Spotify could not add this track to the queue.");
      return;
    }
    showToast(`Added “${actionItem.item.name}” to the queue.`);
    setActionItem(null);
  };

  const addActionItemToPlaylist = async () => {
    if (!actionItem || !destinationPlaylistId || actionPending) return;
    setActionPending("playlist");
    setActionError("");
    try {
      const result = await getJson<{ snapshotId: string }>(
        `/api/playlists/${encodeURIComponent(destinationPlaylistId)}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uri: actionItem.item.uri }),
        },
      );
      const destination = playlists.find(
        (playlist) => playlist.id === destinationPlaylistId,
      );
      const updatePlaylist = (playlist: Playlist): Playlist =>
        playlist.id === destinationPlaylistId
          ? {
              ...playlist,
              itemCount: playlist.itemCount + 1,
              snapshot_id: result.snapshotId,
            }
          : playlist;
      setPlaylists((current) => current.map(updatePlaylist));
      setSelected((current) => current ? updatePlaylist(current) : current);
      if (loadedPlaylistId === destinationPlaylistId) {
        setItems((current) => [
          ...current,
          {
            added_at: new Date().toISOString(),
            is_local: false,
            item: actionItem.item,
            key: `added:${result.snapshotId}:${current.length}`,
            originalIndex: current.length,
            position: current.length,
          },
        ]);
      }
      rememberPlaylistDestination(destinationPlaylistId);
      showToast(
        `Added “${actionItem.item.name}” to ${destination?.name ?? "the playlist"}.`,
      );
      setActionItem(null);
    } catch (addError) {
      setActionError(
        addError instanceof Error
          ? addError.message
          : "Could not add this track to the playlist.",
      );
    } finally {
      setActionPending("");
    }
  };

  const shuffle = () => {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    setItems(shuffled.map((entry, position) => ({ ...entry, position })));
    setSortKey("position");
    setDescending(false);
  };

  const persistOrder = async () => {
    if (
      !selected ||
      query ||
      error ||
      loadingItems ||
      loadedPlaylistId !== selected.id
    ) return;
    setSaving(true);
    setSaveProgress(0);
    setError("");
    try {
      const desired = visibleItems.map((entry) => entry.originalIndex);
      let currentOrder = Array.from(
        { length: desired.length },
        (_, index) => index,
      );
      let snapshotId = selected.snapshot_id;
      let totalMoves = 0;
      let complete = false;
      let batches = 0;

      while (!complete) {
        const result = await getJson<{
          snapshotId: string;
          moves: number;
          currentOrder: number[];
          settled: number;
          total: number;
          complete: boolean;
          paused: boolean;
          retryAfter?: number;
        }>(
          `/api/playlists/${encodeURIComponent(selected.id)}/reorder`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              order: desired,
              currentOrder,
              snapshotId,
            }),
          },
        );
        if (!result.complete && result.moves === 0 && !result.paused) {
          throw new Error("Spotify could not make progress. Refresh and try again.");
        }

        currentOrder = result.currentOrder;
        snapshotId = result.snapshotId;
        totalMoves += result.moves;
        complete = result.complete;
        batches += 1;
        setSaveProgress(
          result.total === 0
            ? 100
            : Math.min(100, Math.round((result.settled / result.total) * 100)),
        );

        if (batches > desired.length + 1) {
          throw new Error("Spotify could not finish saving this order.");
        }
        if (result.paused) {
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              Math.max(1, result.retryAfter ?? 1) * 1000,
            ),
          );
        }
      }

      const committed = visibleItems.map((entry, position) => ({
        ...entry,
        position,
        originalIndex: position,
      }));
      setItems(committed);
      const updatedPlaylist = { ...selected, snapshot_id: snapshotId };
      setSelected(updatedPlaylist);
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === updatedPlaylist.id ? updatedPlaylist : playlist,
        ),
      );
      setSortKey("position");
      setDescending(false);
      setToast(
        totalMoves
          ? `Saved ${totalMoves} playlist moves to Spotify.`
          : "Playlist was already in this order.",
      );
      window.setTimeout(() => setToast(""), 3200);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the order.");
    } finally {
      setSaving(false);
      setSaveProgress(0);
    }
  };

  const contextEntry = songContextMenu?.entry;
  const contextCanUseTrack =
    contextEntry !== undefined &&
    !contextEntry.is_local &&
    contextEntry.item.is_local !== true &&
    /^spotify:track:[a-zA-Z0-9]{22}$/.test(contextEntry.item.uri);
  const contextCanPlay =
    contextCanUseTrack && contextEntry.item.is_playable !== false;
  const contextAlbumHref = contextEntry?.item.album
    ? spotifyAppHref({
        uri: contextEntry.item.album.uri,
        webUrl: contextEntry.item.album.external_urls?.spotify,
      })
    : null;

  return (
    <main className="main playlist-main">
      <header className="page-heading">
        <div>
          <div className="eyebrow">Playlist desk</div>
          <h1>Put every track in place.</h1>
        </div>
        <p>
          Choose an editable playlist, sort its full contents, then commit that exact
          order back to Spotify.
        </p>
      </header>
      {loadingLists ? (
        <div className="loading-state">
          <LoaderCircle className="spinner" size={26} />Loading your playlists
        </div>
      ) : playlists.length === 0 ? (
        <div className="empty">
          <ListMusic size={28} />No owned or collaborative playlists were found.
        </div>
      ) : (
        <div
          className={`playlist-layout ${
            playlistSidebarCollapsed ? "sidebar-collapsed" : ""
          }`}
        >
          <aside className="playlist-sidebar" aria-label="Editable playlists">
            <div className="playlist-sidebar-tools">
              <label className="playlist-search">
                <Search size={15} color="var(--dim)" />
                <input
                  aria-label="Search playlists"
                  onChange={(event) => setPlaylistQuery(event.target.value)}
                  placeholder={`Search ${playlists.length} playlists`}
                  type="search"
                  value={playlistQuery}
                />
              </label>
              <button
                aria-controls="playlist-sidebar-list"
                aria-expanded={!playlistSidebarCollapsed}
                aria-label={
                  playlistSidebarCollapsed
                    ? "Expand playlist sidebar"
                    : "Collapse playlist sidebar"
                }
                className="playlist-sidebar-toggle"
                onClick={() => setPlaylistSidebarCollapsed((collapsed) => !collapsed)}
                title={
                  playlistSidebarCollapsed
                    ? "Expand playlist sidebar"
                    : "Collapse playlist sidebar"
                }
                type="button"
              >
                {playlistSidebarCollapsed
                  ? <PanelLeftOpen size={17} />
                  : <PanelLeftClose size={17} />}
              </button>
            </div>
            <div className="playlist-list" id="playlist-sidebar-list">
              {visiblePlaylists.length === 0 ? (
                <div className="playlist-list-empty" role="status">
                  No playlists match “{playlistQuery.trim()}”.
                </div>
              ) : (
                visiblePlaylists.map((playlist) => {
                  const coverUrl = preferredSpotifyImage(playlist.images);
                  return (
                    <button
                      aria-label={`Select playlist ${playlist.name}`}
                      aria-current={
                        selected?.id === playlist.id ? "true" : undefined
                      }
                      className={`playlist-row ${
                        selected?.id === playlist.id ? "selected" : ""
                      }`}
                      disabled={saving}
                      key={playlist.id}
                      onClick={() => {
                        if (selected?.id === playlist.id) return;
                        itemLoadController.current?.abort();
                        setItems([]);
                        setLoadedPlaylistId(null);
                        setSelected(playlist);
                      }}
                      title={playlistSidebarCollapsed ? playlist.name : undefined}
                      type="button"
                    >
                      {coverUrl ? (
                        <img
                          alt=""
                          decoding="async"
                          loading="lazy"
                          src={coverUrl}
                        />
                      ) : (
                        <div className="playlist-cover-placeholder">
                          <Music2 size={20} />
                        </div>
                      )}
                      <div className="playlist-row-copy">
                        <h3>{playlist.name}</h3>
                        <p>
                          {playlist.itemCount} items ·{" "}
                          {playlist.collaborative
                            ? "Collaborative"
                            : playlist.public
                              ? "Public"
                              : "Private"}
                        </p>
                      </div>
                      <ChevronRight
                        className="playlist-row-chevron"
                        size={16}
                        color="var(--dim)"
                      />
                    </button>
                  );
                })
              )}
            </div>
          </aside>
          <section className="playlist-panel">
            <div className="playlist-panel-head">
              <div>
                <h2>{selected?.name}</h2>
                <p>{items.length} loaded items · configure and sort metadata</p>
                {selectedOutsideFilter && (
                  <button
                    className="playlist-filter-reset"
                    onClick={() => setPlaylistQuery("")}
                    type="button"
                  >
                    Active playlist is hidden by the search — show it
                  </button>
                )}
              </div>
              <div className="panel-actions">
                {selected && (
                  <button
                    className="secondary-button"
                    disabled={
                      loadingItems ||
                      Boolean(playback.pendingKey) ||
                      !playback.deviceReady
                    }
                    onClick={() =>
                      void playback.play(
                        { contextUri: `spotify:playlist:${selected.id}` },
                        `playlist:${selected.id}`,
                      )
                    }
                    type="button"
                  >
                    {playback.pendingKey === `playlist:${selected.id}`
                      ? <LoaderCircle className="spinner" size={14} />
                      : <Play size={14} fill="currentColor" />}
                    Play
                  </button>
                )}
                <button
                  className="secondary-button"
                  disabled={
                    loadingItems ||
                    saving ||
                    loadedPlaylistId !== selected?.id
                  }
                  onClick={shuffle}
                  type="button"
                >
                  <Shuffle size={14} /> Shuffle
                </button>
                <button
                  className="primary-button"
                  disabled={
                    loadingItems ||
                    saving ||
                    Boolean(query) ||
                    Boolean(error) ||
                    loadedPlaylistId !== selected?.id
                  }
                  onClick={() => void persistOrder()}
                  title={
                    query
                      ? "Clear search before saving a reordered playlist"
                      : error
                        ? "Refresh the playlist before saving"
                        : loadedPlaylistId !== selected?.id
                          ? "Wait for this playlist to finish loading"
                          : undefined
                  }
                  type="button"
                >
                  {saving ? <LoaderCircle className="spinner" size={14} /> : <ArrowUpDown size={14} />}
                  {saving ? `Saving ${saveProgress}%…` : "Save order"}
                </button>
              </div>
            </div>
            <div className="toolbar playlist-toolbar">
              <label className="search">
                <Search size={15} color="var(--dim)" />
                <input
                  aria-label="Search playlist"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a track, artist or album"
                  value={query}
                />
              </label>
              <div className="playlist-toolbar-actions">
                <details className="column-config">
                  <summary className="secondary-button">
                    <Columns3 size={14} />
                    Columns
                    <span>{visibleColumns.length}/{TRACK_COLUMNS.length}</span>
                  </summary>
                  <div className="column-config-panel">
                    <div className="column-config-header">
                      <div>
                        <h3>Song metadata</h3>
                        <p>Choose once; this device remembers it.</p>
                      </div>
                      <div className="column-config-buttons">
                        <button onClick={showAllColumns} type="button">Show all</button>
                        <button onClick={resetColumns} type="button">Defaults</button>
                      </div>
                    </div>
                    {COLUMN_GROUPS.map((group) => (
                      <fieldset className="column-config-group" key={group}>
                        <legend className="column-config-group-title">{group}</legend>
                        <div className="column-config-grid">
                          {TRACK_COLUMNS
                            .filter((column) => column.group === group)
                            .map((column) => (
                              <label className="column-config-option" key={column.id}>
                                <input
                                  checked={visibleColumnSet.has(column.id)}
                                  disabled={column.required}
                                  onChange={() => toggleColumn(column)}
                                  type="checkbox"
                                />
                                <span>{column.sortLabel ?? column.label}</span>
                              </label>
                            ))}
                        </div>
                      </fieldset>
                    ))}
                    <p>
                      Spotify links are built into track, artist, album, and contributor
                      values. Missing metadata stays visible as an em dash.
                    </p>
                  </div>
                </details>
                {selected && (
                  <a
                    className="secondary-button"
                    href={
                      spotifyAppHref({
                        kind: "playlist",
                        id: selected.id,
                        webUrl: selected.external_urls.spotify,
                      }) ?? selected.external_urls.spotify
                    }
                    title="Open playlist in Spotify app"
                  >
                    Open Spotify app <ExternalLink size={13} />
                  </a>
                )}
              </div>
            </div>
            {loadingItems ? (
              <div className="loading-state" style={{ border: 0 }}>
                <LoaderCircle className="spinner" size={24} />Loading every track
              </div>
            ) : error ? (
              <div className="error-state" style={{ border: 0 }}>
                <span>{error}</span>
                {selected && (
                  <button className="secondary-button" onClick={() => void loadItems(selected)}>
                    Refresh playlist
                  </button>
                )}
              </div>
            ) : (
              <>
              <div className="mobile-table-tools">
                <label>
                  <span>Sort tracks</span>
                  <select
                    onChange={(event) => {
                      setSortKey(event.target.value as ColumnId);
                      setDescending(false);
                    }}
                    value={sortKey}
                  >
                    {sortableColumns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.sortLabel ?? column.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  aria-label={`Sort ${descending ? "ascending" : "descending"}`}
                  className="secondary-button"
                  onClick={() => setDescending((current) => !current)}
                  type="button"
                >
                  <ArrowUpDown size={14} />
                  {descending ? "Descending" : "Ascending"}
                </button>
              </div>
              <div className="table-scroll">
                <table className="track-table">
                  <thead>
                    <tr>
                      {visibleColumns.map((column) => (
                          <th
                            aria-label={
                              column.id === "albumCover" ? "Album cover" : undefined
                            }
                            aria-sort={
                              sortKey === column.id
                                ? descending
                                  ? "descending"
                                  : "ascending"
                                : undefined
                            }
                            data-column={column.id}
                            key={column.id}
                            scope="col"
                          >
                            {column.id === "albumCover" ? null : column.getSortValue ? (
                              <button
                                className="table-sort-button"
                                onClick={() => sortBy(column.id)}
                                type="button"
                              >
                                {column.label}
                                {sortKey === column.id ? (descending ? " ↓" : " ↑") : ""}
                              </button>
                            ) : column.label}
                          </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((entry, index) => {
                      const canPlay =
                        !entry.is_local &&
                        entry.item.is_local !== true &&
                        entry.item.is_playable !== false &&
                        /^spotify:track:[a-zA-Z0-9]{22}$/.test(entry.item.uri);
                      const canAdd =
                        !entry.is_local &&
                        entry.item.is_local !== true &&
                        /^spotify:track:[a-zA-Z0-9]{22}$/.test(entry.item.uri);
                      const playbackKey = `track:${entry.key}`;
                      const spotifyHref = spotifyAppHref({
                        uri: entry.item.uri,
                        webUrl: entry.item.external_urls?.spotify,
                      });
                      const isCurrentTrack =
                        playback.currentTrackUri === entry.item.uri;
                      return (
                      <tr
                        className={isCurrentTrack ? "current-track" : undefined}
                        key={entry.key}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          const menuWidth = 236;
                          const menuHeight = 202;
                          setSongContextMenu({
                            entry,
                            x: Math.max(
                              12,
                              Math.min(event.clientX, window.innerWidth - menuWidth - 12),
                            ),
                            y: Math.max(
                              12,
                              Math.min(event.clientY, window.innerHeight - menuHeight - 12),
                            ),
                          });
                        }}
                      >
                        {visibleColumns.map((column) => (
                          <td
                            className={column.className}
                            data-column={column.id}
                            data-label={column.sortLabel ?? column.label}
                            key={column.id}
                          >
                            {column.id === "albumCover" ? (
                              <div className="track-cover-actions">
                                <div className="track-cover-art">
                                  {column.render(entry, index)}
                                </div>
                                <div className="track-action-buttons">
                                  <button
                                    aria-label={`Play ${entry.item.name} in this browser`}
                                    disabled={
                                      !canPlay ||
                                      !playback.deviceReady ||
                                      Boolean(playback.pendingKey)
                                    }
                                    onClick={() =>
                                      playPlaylistEntry(entry, playbackKey)
                                    }
                                    title={
                                      canPlay
                                        ? "Play in browser"
                                        : entry.item.is_playable === false
                                          ? "Spotify reports this track as unavailable for playback"
                                          : "Local and unavailable tracks cannot play in the browser"
                                    }
                                    type="button"
                                  >
                                    {playback.pendingKey === playbackKey
                                      ? <LoaderCircle className="spinner" size={13} />
                                      : <Play size={13} fill="currentColor" />}
                                  </button>
                                  {spotifyHref && (
                                    <a
                                      aria-label={`Open ${entry.item.name} in the Spotify app`}
                                      href={spotifyHref}
                                      title="Open in Spotify app"
                                    >
                                      <ExternalLink size={13} />
                                    </a>
                                  )}
                                  <button
                                    aria-label={`More actions for ${entry.item.name}`}
                                    disabled={!canAdd || Boolean(playback.pendingKey)}
                                    onClick={() => openTrackActions(entry)}
                                    title={
                                      canAdd
                                        ? "Queue or add to a playlist"
                                        : "Local tracks cannot be added with the Spotify API"
                                    }
                                    type="button"
                                  >
                                    <Ellipsis size={14} />
                                  </button>
                                </div>
                              </div>
                            ) : column.id === "track" ? (
                              <Fragment>
                                {column.render(entry, index)}
                                {isCurrentTrack && (
                                  <span className="now-playing-indicator">
                                    {playback.isPlaying ? "Playing" : "Paused"}
                                  </span>
                                )}
                              </Fragment>
                            ) : column.render(entry, index)}
                          </td>
                        ))}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>
        </div>
      )}
      {songContextMenu && contextEntry && (
        <div
          aria-label={`Actions for ${contextEntry.item.name}`}
          className="song-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: songContextMenu.x, top: songContextMenu.y }}
        >
          <div className="song-context-heading">
            <strong>{contextEntry.item.name}</strong>
            <span>
              {contextEntry.item.artists?.map((artist) => artist.name).join(", ") ||
                "Unknown artist"}
            </span>
          </div>
          <button
            disabled={
              !contextCanPlay ||
              !playback.deviceReady ||
              Boolean(playback.pendingKey)
            }
            onClick={() => {
              setSongContextMenu(null);
              playPlaylistEntry(
                contextEntry,
                `context-play:${contextEntry.key}`,
              );
            }}
            role="menuitem"
            type="button"
          >
            <Play size={15} fill="currentColor" />
            Play
          </button>
          <button
            disabled={
              !contextCanUseTrack ||
              !playback.authorized ||
              Boolean(playback.pendingKey)
            }
            onClick={() => void addContextSongToQueue(contextEntry)}
            role="menuitem"
            type="button"
          >
            <ListEnd size={15} />
            Add to queue
          </button>
          <button
            disabled={!contextCanUseTrack || Boolean(playback.pendingKey)}
            onClick={() => {
              setSongContextMenu(null);
              openTrackActions(contextEntry, true);
            }}
            role="menuitem"
            type="button"
          >
            <ListPlus size={15} />
            Add to playlist
          </button>
          {contextAlbumHref ? (
            <a href={contextAlbumHref} role="menuitem">
              <ExternalLink size={15} />
              Go to album in Spotify
            </a>
          ) : (
            <button disabled role="menuitem" type="button">
              <ExternalLink size={15} />
              Album unavailable
            </button>
          )}
        </div>
      )}
      {actionItem && (
        <div
          className="track-action-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !actionPending) {
              setActionItem(null);
            }
          }}
        >
          <section
            aria-labelledby="track-action-title"
            aria-modal="true"
            className={`track-action-dialog ${
              actionPlaylistOnly ? "playlist-picker-dialog" : ""
            }`}
            role="dialog"
          >
            <header className="track-action-dialog-head">
              <div>
                <span>
                  {actionPlaylistOnly ? "Add to playlist" : "Song actions"}
                </span>
                <h2 id="track-action-title">{actionItem.item.name}</h2>
                <p>
                  {actionItem.item.artists?.map((artist) => artist.name).join(", ") ||
                    "Unknown artist"}
                </p>
              </div>
              <button
                aria-label="Close song actions"
                disabled={Boolean(actionPending)}
                onClick={() => setActionItem(null)}
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            {!actionPlaylistOnly && (
              <button
                className="track-action-primary"
                disabled={Boolean(actionPending) || !playback.authorized}
                onClick={() => void addActionItemToQueue()}
                type="button"
              >
                {actionPending === "queue"
                  ? <LoaderCircle className="spinner" size={17} />
                  : <ListEnd size={17} />}
                <span>
                  <strong>Add to queue</strong>
                  <small>Play it next on your active Spotify player</small>
                </span>
              </button>
            )}
            <div className="track-action-playlist">
              <label htmlFor="track-action-playlist-search">
                Add to a playlist
              </label>
              <label className="track-action-playlist-search">
                <Search aria-hidden="true" size={14} />
                <input
                  autoFocus={actionPlaylistOnly}
                  disabled={Boolean(actionPending)}
                  id="track-action-playlist-search"
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    const needle = nextQuery.trim().toLocaleLowerCase();
                    const nextMatches = needle
                      ? orderedActionPlaylists.filter((playlist) =>
                          playlist.name.toLocaleLowerCase().includes(needle),
                        )
                      : orderedActionPlaylists;
                    setActionPlaylistQuery(nextQuery);
                    if (
                      !nextMatches.some(
                        (playlist) => playlist.id === destinationPlaylistId,
                      )
                    ) {
                      setDestinationPlaylistId(nextMatches[0]?.id ?? "");
                    }
                  }}
                  placeholder="Search playlists"
                  value={actionPlaylistQuery}
                />
              </label>
              <div
                aria-label="Destination playlist"
                className="track-action-playlist-list"
                role="listbox"
              >
                {filteredActionPlaylists.length === 0 ? (
                  <div className="track-action-playlist-empty" role="status">
                    No playlists match “{actionPlaylistQuery.trim()}”.
                  </div>
                ) : (
                  filteredActionPlaylists.map((playlist) => {
                    const coverUrl = preferredSpotifyImage(playlist.images);
                    const isSelected =
                      playlist.id === destinationPlaylistId;
                    return (
                      <button
                        aria-selected={isSelected}
                        className={isSelected ? "selected" : ""}
                        disabled={Boolean(actionPending)}
                        key={playlist.id}
                        onClick={() =>
                          setDestinationPlaylistId(playlist.id)
                        }
                        role="option"
                        type="button"
                      >
                        {coverUrl ? (
                          <img alt="" src={coverUrl} />
                        ) : (
                          <span className="track-action-playlist-cover">
                            <ListMusic size={16} />
                          </span>
                        )}
                        <span className="track-action-playlist-copy">
                          <strong>{playlist.name}</strong>
                          <small>
                            {playlist.itemCount} item
                            {playlist.itemCount === 1 ? "" : "s"}
                          </small>
                        </span>
                        {recentPlaylistIdSet.has(playlist.id) && (
                          <em>Recent</em>
                        )}
                        {isSelected && <Check size={15} />}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                className="primary-button"
                disabled={!destinationPlaylistId || Boolean(actionPending)}
                onClick={() => void addActionItemToPlaylist()}
                type="button"
              >
                {actionPending === "playlist"
                  ? <LoaderCircle className="spinner" size={15} />
                  : <ListPlus size={15} />}
                Add to playlist
              </button>
            </div>
            {actionError && (
              <p className="track-action-error" role="alert">{actionError}</p>
            )}
          </section>
        </div>
      )}
      <p className="legal-note">
        Popularity, BPM, key and audio-analysis fields are unavailable to this Spotify
        app. Track metadata links back to Spotify.
      </p>
      {toast && <div className="toast"><Check size={15} />{toast}</div>}
    </main>
  );
}

export function SpotifyApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<"releases" | "playlists">("releases");
  const [authError, setAuthError] = useState("");
  const [playbackAuthorized, setPlaybackAuthorized] = useState(false);

  useEffect(() => {
    setAuthError(new URLSearchParams(window.location.search).get("auth_error") || "");
    void (async () => {
      try {
        const data = await getJson<{ user: User; playbackAuthorized: boolean }>("/api/session");
        setUser(data.user);
        setPlaybackAuthorized(data.playbackAuthorized);
      } catch {
        setUser(null);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  if (checking) {
    return (
      <div className="loading-state full-screen-state" style={{ border: 0 }}>
        <LoaderCircle className="spinner" size={28} />Opening your desk
      </div>
    );
  }

  const shell = (
    <div className={`app-shell ${user ? "with-player" : ""}`}>
      <header className="topbar">
        <button
          className="brand"
          onClick={() => setView("releases")}
          style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", padding: 0 }}
          type="button"
        >
          <span className="brand-mark"><Sparkles size={14} fill="currentColor" /></span>
          Tadi Tech 2.0
        </button>
        {user && (
          <nav className="nav" aria-label="Main navigation">
            <button
              className={view === "releases" ? "active" : ""}
              onClick={() => setView("releases")}
              type="button"
            >
              <Clock3 size={14} /> Releases
            </button>
            <button
              className={view === "playlists" ? "active" : ""}
              onClick={() => setView("playlists")}
              type="button"
            >
              <ListMusic size={14} /> Playlists
            </button>
          </nav>
        )}
        <div className="account">
          {user ? (
            <>
              {user.images?.[0] ? (
                <img className="avatar" alt="" src={user.images[0].url} />
              ) : (
                <div className="avatar-placeholder">{(user.display_name || "S")[0]}</div>
              )}
              <span className="account-name">{user.display_name || "Spotify user"}</span>
              <button
                aria-label="Disconnect Spotify"
                className="icon-button"
                onClick={() => {
                  releaseMemoryCache.delete(user.id);
                  void clearCachedReleaseScan(user.id).finally(() => {
                    window.location.assign("/api/auth/logout");
                  });
                }}
                style={{ background: "transparent", color: "var(--muted)", padding: 6 }}
                type="button"
              >
                <LogOut size={15} />
              </button>
            </>
          ) : (
            <CircleUserRound size={20} color="var(--dim)" />
          )}
        </div>
      </header>
      {!user
        ? <Landing authError={authError} />
        : view === "releases"
          ? <ReleasesView key={user.id} userId={user.id} />
          : <PlaylistsView />}
    </div>
  );

  return user ? (
    <PlaybackProvider authorized={playbackAuthorized}>
      {shell}
    </PlaybackProvider>
  ) : shell;
}
