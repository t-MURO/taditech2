import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpotifyImages,
  normalizeSpotifyTrack,
  normalizeSpotifyUserReference,
  preferredSpotifyImage,
} from "./spotify-data.ts";

test("normalizes nullable and malformed Spotify image arrays", () => {
  assert.deepEqual(normalizeSpotifyImages(null), []);
  assert.deepEqual(normalizeSpotifyImages([]), []);
  assert.deepEqual(
    normalizeSpotifyImages([
      null,
      {},
      { url: "" },
      { url: "cover.jpg" },
      { url: "sized.jpg", height: 0, width: null },
      { url: "invalid-size.jpg", height: -1, width: Number.NaN },
    ]),
    [
      { url: "cover.jpg" },
      { url: "sized.jpg", height: 0, width: null },
      { url: "invalid-size.jpg" },
    ],
  );
});

test("prefers Spotify's second image and falls back to the first", () => {
  assert.equal(preferredSpotifyImage([{ url: "large.jpg" }]), "large.jpg");
  assert.equal(
    preferredSpotifyImage([{ url: "large.jpg" }, { url: "medium.jpg" }]),
    "medium.jpg",
  );
  assert.equal(preferredSpotifyImage(null), undefined);
});

test("replaces null playlist items with a stable unavailable item", () => {
  assert.deepEqual(normalizeSpotifyTrack(null, 7), {
    id: null,
    uri: "spotify:unavailable:7",
    name: "Unavailable item",
    type: "unknown",
  });
});

test("sanitizes nullable nested track metadata", () => {
  assert.deepEqual(
    normalizeSpotifyTrack({
      id: null,
      uri: null,
      name: null,
      type: "track",
      artists: [null, { id: null, name: "Artist" }],
      album: {
        id: null,
        name: null,
        images: null,
      },
    }, 3),
    {
      id: null,
      uri: "spotify:unavailable:3",
      name: "Unavailable item",
      type: "track",
      artists: [{ id: "", name: "Artist" }],
      album: {
        id: "",
        name: "Unknown album",
        images: [],
      },
    },
  );
});

test("normalizes useful track metadata without losing zero or false", () => {
  const track = normalizeSpotifyTrack({
    id: "track-id",
    uri: "spotify:track:track-id",
    href: "https://api.spotify.com/v1/tracks/track-id",
    preview_url: null,
    name: "Track",
    type: "track",
    duration_ms: 0,
    explicit: false,
    popularity: 87,
    track_number: 0,
    disc_number: 0,
    is_playable: false,
    is_local: false,
    restrictions: { reason: "market" },
    external_ids: {
      isrc: "ISRC123",
      ean: "EAN123",
      upc: "UPC123",
    },
    external_urls: { spotify: "https://open.spotify.com/track/track-id" },
    artists: [{
      id: "artist-id",
      name: "Artist",
      uri: "spotify:artist:artist-id",
      href: "https://api.spotify.com/v1/artists/artist-id",
      type: "artist",
      external_urls: {
        spotify: "https://open.spotify.com/artist/artist-id",
      },
    }],
    album: {
      id: "album-id",
      name: "Album",
      uri: "spotify:album:album-id",
      href: "https://api.spotify.com/v1/albums/album-id",
      type: "album",
      album_type: "album",
      total_tracks: 0,
      release_date: "2026-07",
      release_date_precision: "month",
      restrictions: { reason: "market" },
      images: [{ url: "album.jpg", height: 0, width: null }],
      external_urls: {
        spotify: "https://open.spotify.com/album/album-id",
      },
      artists: [{
        id: "album-artist-id",
        name: "Album Artist",
        uri: "spotify:artist:album-artist-id",
        href: "https://api.spotify.com/v1/artists/album-artist-id",
        type: "artist",
        external_urls: {
          spotify: "https://open.spotify.com/artist/album-artist-id",
        },
      }],
    },
  }, 0);

  assert.deepEqual(track, {
    id: "track-id",
    uri: "spotify:track:track-id",
    href: "https://api.spotify.com/v1/tracks/track-id",
    preview_url: null,
    name: "Track",
    type: "track",
    duration_ms: 0,
    explicit: false,
    track_number: 0,
    disc_number: 0,
    is_playable: false,
    is_local: false,
    restrictions: { reason: "market" },
    external_ids: {
      isrc: "ISRC123",
      ean: "EAN123",
      upc: "UPC123",
    },
    external_urls: { spotify: "https://open.spotify.com/track/track-id" },
    artists: [{
      id: "artist-id",
      name: "Artist",
      uri: "spotify:artist:artist-id",
      href: "https://api.spotify.com/v1/artists/artist-id",
      type: "artist",
      external_urls: {
        spotify: "https://open.spotify.com/artist/artist-id",
      },
    }],
    album: {
      id: "album-id",
      name: "Album",
      uri: "spotify:album:album-id",
      href: "https://api.spotify.com/v1/albums/album-id",
      type: "album",
      album_type: "album",
      total_tracks: 0,
      release_date: "2026-07",
      release_date_precision: "month",
      restrictions: { reason: "market" },
      images: [{ url: "album.jpg", height: 0, width: null }],
      external_urls: {
        spotify: "https://open.spotify.com/album/album-id",
      },
      artists: [{
        id: "album-artist-id",
        name: "Album Artist",
        uri: "spotify:artist:album-artist-id",
        href: "https://api.spotify.com/v1/artists/album-artist-id",
        type: "artist",
        external_urls: {
          spotify: "https://open.spotify.com/artist/album-artist-id",
        },
      }],
    },
  });
  assert.equal("popularity" in track, false);
});

test("normalizes the available playlist contributor metadata", () => {
  assert.deepEqual(normalizeSpotifyUserReference({
    id: "user-id",
    uri: "spotify:user:user-id",
    href: "https://api.spotify.com/v1/users/user-id",
    type: "user",
    external_urls: { spotify: "https://open.spotify.com/user/user-id" },
  }), {
    id: "user-id",
    uri: "spotify:user:user-id",
    href: "https://api.spotify.com/v1/users/user-id",
    type: "user",
    external_urls: { spotify: "https://open.spotify.com/user/user-id" },
  });
  assert.deepEqual(normalizeSpotifyUserReference({
    id: null,
    uri: "spotify:user:anonymous",
  }), {
    uri: "spotify:user:anonymous",
  });
  assert.equal(normalizeSpotifyUserReference({}), undefined);
});
