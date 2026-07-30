"use client";
/* eslint-disable react-hooks/set-state-in-effect, @next/next/no-img-element */

import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  ExternalLink,
  ListMusic,
  LoaderCircle,
  LogOut,
  Music2,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { preferredSpotifyImage } from "@/lib/spotify-data";
import { PlaybackProvider, usePlayback } from "./spotify-player";

type User = {
  id: string;
  display_name: string | null;
  images?: Array<{ url: string }> | null;
};
type Release = {
  id: string;
  name: string;
  album_type: string;
  release_date: string;
  total_tracks: number;
  images?: Array<{ url: string }> | null;
  artists: Array<{ id: string; name: string }>;
  external_urls: { spotify: string };
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
type Track = {
  id: string | null;
  uri: string;
  name: string;
  type: string;
  duration_ms?: number;
  explicit?: boolean;
  external_urls?: { spotify: string };
  artists?: Array<{ id: string; name: string }>;
  album?: {
    id: string;
    name: string;
    release_date?: string;
  };
};
type PlaylistItem = {
  key: string;
  originalIndex: number;
  position: number;
  added_at: string | null;
  is_local: boolean;
  item: Track;
};
type SortKey =
  | "position"
  | "name"
  | "artist"
  | "album"
  | "duration"
  | "release"
  | "added";

type ReleaseScanSnapshot = {
  releases: Release[];
  artistCount: number;
  scannedArtists: number;
  nextCursor: string | null;
  complete: boolean;
  timestamp: number;
};

type ReleaseBatch = {
  releases: Release[];
  artistCount: number;
  scannedArtists: number;
  nextCursor: string | null;
  complete: boolean;
};

let releaseMemoryCache: ReleaseScanSnapshot | undefined;

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
  if (!date) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date.length === 4 ? `${date}-01-01` : date));
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

function ReleasesView() {
  const playback = usePlayback();
  const [releases, setReleases] = useState<Release[]>(() => releaseMemoryCache?.releases || []);
  const [artistCount, setArtistCount] = useState(() => releaseMemoryCache?.artistCount || 0);
  const [scannedArtists, setScannedArtists] = useState(
    () => releaseMemoryCache?.scannedArtists || 0,
  );
  const [scanComplete, setScanComplete] = useState(
    () => releaseMemoryCache?.complete || false,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("newest");
  const scanController = useRef<AbortController | null>(null);

  const scan = useCallback(async () => {
    scanController.current?.abort();
    const controller = new AbortController();
    scanController.current = controller;

    const resumable =
      releaseMemoryCache &&
      !releaseMemoryCache.complete &&
      releaseMemoryCache.nextCursor
        ? releaseMemoryCache
        : undefined;
    const merged = new Map(
      (resumable?.releases ?? []).map((release) => [release.id, release]),
    );
    let cursor = resumable?.nextCursor ?? null;
    let scanned = resumable?.scannedArtists ?? 0;
    let total = resumable?.artistCount ?? 0;

    if (!resumable) {
      releaseMemoryCache = undefined;
      setReleases([]);
      setArtistCount(0);
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
        const data = await getJson<ReleaseBatch>(
          cursor
            ? `/api/releases?after=${encodeURIComponent(cursor)}`
            : "/api/releases",
          { signal: controller.signal },
        );

        for (const release of data.releases) merged.set(release.id, release);
        scanned += data.scannedArtists;
        total = Math.max(total, data.artistCount, scanned);

        const sorted = Array.from(merged.values()).sort((a, b) =>
          b.release_date.localeCompare(a.release_date),
        );
        const nextCursor = data.complete ? null : data.nextCursor;
        if (nextCursor && nextCursor === cursor) {
          throw new Error("Spotify returned the same artist page twice. Continue the scan later.");
        }

        const snapshot: ReleaseScanSnapshot = {
          releases: sorted,
          artistCount: total,
          scannedArtists: scanned,
          nextCursor,
          complete: !nextCursor,
          timestamp: Date.now(),
        };
        releaseMemoryCache = snapshot;
        setReleases(sorted);
        setArtistCount(total);
        setScannedArtists(scanned);
        setScanComplete(snapshot.complete);

        if (!nextCursor) break;
        cursor = nextCursor;
      }
    } catch (scanError) {
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
  }, []);

  useEffect(() => () => scanController.current?.abort(), []);

  const visible = useMemo(() => {
    const needle = query.toLowerCase();
    const filtered = releases.filter((release) =>
      `${release.name} ${release.artists.map((artist) => artist.name).join(" ")}`
        .toLowerCase()
        .includes(needle),
    );
    return [...filtered].sort((a, b) => {
      if (sort === "oldest") return a.release_date.localeCompare(b.release_date);
      if (sort === "artist") {
        return a.artists[0]?.name.localeCompare(b.artists[0]?.name || "") || 0;
      }
      if (sort === "title") return a.name.localeCompare(b.name);
      return b.release_date.localeCompare(a.release_date);
    });
  }, [query, releases, sort]);

  const hasProgress = scannedArtists > 0;
  const scanButtonLabel = loading
    ? "Scanning…"
    : scanComplete
      ? "Scan again"
      : hasProgress
        ? "Continue scan"
        : "Check now";

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
              {hasProgress && !scanComplete && artistCount
                ? `${scannedArtists}/${artistCount}`
                : artistCount || "—"}
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
            <option value="artist">Artist A–Z</option>
            <option value="title">Title A–Z</option>
          </select>
          <button
            className="secondary-button"
            disabled={loading}
            onClick={() => void scan()}
            type="button"
          >
            <RefreshCw className={loading ? "spinner" : undefined} size={14} />
            {scanButtonLabel}
          </button>
        </div>
      </div>
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
              Spotify requests run in small batches and pause automatically when needed.
            </small>
          </div>
        </div>
      )}
      {!loading && error && (
        <div className="error-state">
          <span>{error}</span>
          <button className="secondary-button" onClick={() => void scan()}>
            {hasProgress ? "Continue scan" : "Try again"}
          </button>
        </div>
      )}
      {!loading && !error && !scanComplete && (
        <div className="empty">
          <Sparkles size={28} />
          <strong>{hasProgress ? "Your partial scan is saved." : "Check when you're ready."}</strong>
          <span>
            {hasProgress
              ? `Continue from artist ${scannedArtists + 1}; completed batches will not be fetched again.`
              : "No release requests are sent until you start the scan."}
          </span>
          <button className="primary-button" onClick={() => void scan()} type="button">
            {hasProgress ? "Continue release scan" : "Check for new releases"}
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      {!loading && !error && scanComplete && visible.length === 0 && (
        <div className="empty">
          <Music2 size={28} />
          <span>
            {query ? "No releases match this search." : "No recent releases were found."}
          </span>
        </div>
      )}
      {visible.length > 0 && (
        <div className="release-grid">
          {visible.map((release) => {
            const playbackKey = `album:${release.id}`;
            const coverUrl = preferredSpotifyImage(release.images);
            return (
            <article
              className="release-card"
              key={release.id}
            >
              <div className="cover-wrap">
                {coverUrl && (
                  <img
                    alt=""
                    decoding="async"
                    loading="lazy"
                    src={coverUrl}
                  />
                )}
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
                    aria-label={`Open ${release.name} in Spotify`}
                    href={release.external_urls.spotify}
                    rel="noreferrer"
                    target="_blank"
                    title="Open in Spotify"
                  >
                    <ExternalLink size={15} />
                  </a>
                </div>
              </div>
              <h3>
                <a href={release.external_urls.spotify} rel="noreferrer" target="_blank">
                  {release.name}
                </a>
              </h3>
              <p>{release.artists.map((artist) => artist.name).join(", ")}</p>
              <div className="release-meta">
                <span>{formatDate(release.release_date)}</span>
                <span>{release.total_tracks} track{release.total_tracks === 1 ? "" : "s"}</span>
              </div>
            </article>
          )})}
        </div>
      )}
      <p className="legal-note">
        Metadata and cover art provided by Spotify. Open any release to view it on Spotify.
      </p>
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
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [descending, setDescending] = useState(false);
  const [toast, setToast] = useState("");

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

  const loadItems = useCallback(async (playlist: Playlist) => {
    setLoadingItems(true);
    setError("");
    try {
      const data = await getJson<{ items: Omit<PlaylistItem, "position">[] }>(
        `/api/playlists/${encodeURIComponent(playlist.id)}/items`,
      );
      setItems(data.items.map((item, position) => ({ ...item, position })));
      setSortKey("position");
      setDescending(false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load this playlist.");
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadItems(selected);
  }, [loadItems, selected]);

  const valueFor = useCallback((entry: PlaylistItem, key: SortKey) => {
    const track = entry.item;
    if (key === "name") return (track.name ?? "").toLowerCase();
    if (key === "artist") return (track.artists?.[0]?.name ?? "").toLowerCase();
    if (key === "album") return (track.album?.name ?? "").toLowerCase();
    if (key === "duration") return track.duration_ms || 0;
    if (key === "release") return track.album?.release_date || "";
    if (key === "added") return entry.added_at || "";
    return entry.position;
  }, []);

  const visibleItems = useMemo(() => {
    const needle = query.toLowerCase();
    const filtered = items.filter((entry) =>
      `${entry.item.name} ${entry.item.artists?.map((artist) => artist.name).join(" ")} ${entry.item.album?.name || ""}`
        .toLowerCase()
        .includes(needle),
    );
    return [...filtered].sort((a, b) => {
      const left = valueFor(a, sortKey);
      const right = valueFor(b, sortKey);
      const compared = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right));
      return descending ? -compared : compared;
    });
  }, [descending, items, query, sortKey, valueFor]);

  const sortBy = (key: SortKey) => {
    if (sortKey === key) setDescending((current) => !current);
    else {
      setSortKey(key);
      setDescending(false);
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
    if (!selected || query) return;
    setSaving(true);
    setError("");
    try {
      const desired = visibleItems.map((entry) => entry.originalIndex);
      const result = await getJson<{ snapshotId: string; moves: number }>(
        `/api/playlists/${encodeURIComponent(selected.id)}/reorder`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: desired, snapshotId: selected.snapshot_id }),
        },
      );
      const committed = visibleItems.map((entry, position) => ({
        ...entry,
        position,
        originalIndex: position,
      }));
      setItems(committed);
      setSelected({ ...selected, snapshot_id: result.snapshotId });
      setSortKey("position");
      setDescending(false);
      setToast(
        result.moves
          ? `Saved ${result.moves} playlist moves to Spotify.`
          : "Playlist was already in this order.",
      );
      window.setTimeout(() => setToast(""), 3200);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="main">
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
        <div className="playlist-layout">
          <aside className="playlist-sidebar playlist-list" aria-label="Editable playlists">
            {playlists.map((playlist) => {
              const coverUrl = preferredSpotifyImage(playlist.images);
              return (
              <button
                className={`playlist-row ${selected?.id === playlist.id ? "selected" : ""}`}
                key={playlist.id}
                onClick={() => setSelected(playlist)}
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
                  <div className="playlist-cover-placeholder"><Music2 size={20} /></div>
                )}
                <div>
                  <h3>{playlist.name}</h3>
                  <p>
                    {playlist.itemCount} items ·{" "}
                    {playlist.collaborative ? "Collaborative" : playlist.public ? "Public" : "Private"}
                  </p>
                </div>
                <ChevronRight size={16} color="var(--dim)" />
              </button>
              );
            })}
          </aside>
          <section className="playlist-panel">
            <div className="playlist-panel-head">
              <div>
                <h2>{selected?.name}</h2>
                <p>{items.length} loaded items · sort by any column</p>
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
                  disabled={loadingItems || saving}
                  onClick={shuffle}
                  type="button"
                >
                  <Shuffle size={14} /> Shuffle
                </button>
                <button
                  className="primary-button"
                  disabled={loadingItems || saving || Boolean(query)}
                  onClick={() => void persistOrder()}
                  title={query ? "Clear search before saving a reordered playlist" : undefined}
                  type="button"
                >
                  {saving ? <LoaderCircle className="spinner" size={14} /> : <ArrowUpDown size={14} />}
                  {saving ? "Saving…" : "Save order"}
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
              {selected && (
                <a
                  className="secondary-button"
                  href={selected.external_urls.spotify}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Spotify <ExternalLink size={13} />
                </a>
              )}
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
                      setSortKey(event.target.value as SortKey);
                      setDescending(false);
                    }}
                    value={sortKey}
                  >
                    <option value="position">Playlist position</option>
                    <option value="name">Track name</option>
                    <option value="artist">Artist</option>
                    <option value="album">Album</option>
                    <option value="duration">Duration</option>
                    <option value="release">Release date</option>
                    <option value="added">Date added</option>
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
                      {([
                        ["position", "#"],
                        ["name", "Track"],
                        ["artist", "Artist"],
                        ["album", "Album"],
                        ["duration", "Time"],
                        ["release", "Released"],
                        ["added", "Added"],
                      ] as Array<[SortKey, string]>).map(([key, label]) => (
                        <th key={key} onClick={() => sortBy(key)} scope="col">
                          {label}{sortKey === key ? (descending ? " ↓" : " ↑") : ""}
                        </th>
                      ))}
                      <th className="listen-column" scope="col">Listen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((entry, index) => {
                      const canPlay =
                        !entry.is_local &&
                        /^spotify:track:[a-zA-Z0-9]{22}$/.test(entry.item.uri);
                      const playbackKey = `track:${entry.key}`;
                      return (
                      <tr key={entry.key}>
                        <td data-label="Position">{index + 1}</td>
                        <td className="track-title" data-label="Track">
                          {entry.item.external_urls?.spotify ? (
                            <a
                              href={entry.item.external_urls.spotify}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {entry.item.name}
                            </a>
                          ) : entry.item.name}
                          {entry.item.explicit && <span className="explicit">E</span>}
                        </td>
                        <td data-label="Artist">{entry.item.artists?.map((artist) => artist.name).join(", ") || "—"}</td>
                        <td data-label="Album">{entry.item.album?.name || "—"}</td>
                        <td data-label="Duration">{entry.item.duration_ms ? formatDuration(entry.item.duration_ms) : "—"}</td>
                        <td data-label="Released">{formatDate(entry.item.album?.release_date)}</td>
                        <td data-label="Added">{formatDate(entry.added_at)}</td>
                        <td className="track-actions" data-label="Listen">
                          <button
                            aria-label={`Play ${entry.item.name} in this browser`}
                            disabled={
                              !canPlay ||
                              !playback.deviceReady ||
                              Boolean(playback.pendingKey)
                            }
                            onClick={() =>
                              void playback.play({ uris: [entry.item.uri] }, playbackKey)
                            }
                            title={
                              canPlay
                                ? "Play in browser"
                                : "Local and unavailable tracks cannot play in the browser"
                            }
                            type="button"
                          >
                            {playback.pendingKey === playbackKey
                              ? <LoaderCircle className="spinner" size={13} />
                              : <Play size={13} fill="currentColor" />}
                          </button>
                          {entry.item.external_urls?.spotify && (
                            <a
                              aria-label={`Open ${entry.item.name} in Spotify`}
                              href={entry.item.external_urls.spotify}
                              rel="noreferrer"
                              target="_blank"
                              title="Open in Spotify"
                            >
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </td>
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
      <p className="legal-note">
        BPM, key and audio-analysis fields are unavailable to Spotify apps created after
        November 2024. Track metadata links back to Spotify.
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
          Tadi Tech
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
              <a
                aria-label="Disconnect Spotify"
                className="icon-button"
                href="/api/auth/logout"
                style={{ background: "transparent", color: "var(--muted)", padding: 6 }}
              >
                <LogOut size={15} />
              </a>
            </>
          ) : (
            <CircleUserRound size={20} color="var(--dim)" />
          )}
        </div>
      </header>
      {!user
        ? <Landing authError={authError} />
        : view === "releases"
          ? <ReleasesView />
          : <PlaylistsView />}
    </div>
  );

  return user ? (
    <PlaybackProvider authorized={playbackAuthorized}>
      {shell}
    </PlaybackProvider>
  ) : shell;
}
