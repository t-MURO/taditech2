import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSpotifyImages,
  normalizeSpotifyTrack,
  preferredSpotifyImage,
} from "./spotify-data.ts";

test("normalizes nullable and malformed Spotify image arrays", () => {
  assert.deepEqual(normalizeSpotifyImages(null), []);
  assert.deepEqual(normalizeSpotifyImages([]), []);
  assert.deepEqual(
    normalizeSpotifyImages([null, {}, { url: "" }, { url: "cover.jpg" }]),
    [{ url: "cover.jpg" }],
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
