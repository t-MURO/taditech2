import assert from "node:assert/strict";
import test from "node:test";
import {
  spotifyAppHref,
  spotifyAppUri,
  spotifyAppUriFromWebUrl,
} from "./spotify-links.ts";

test("prefers a valid Spotify app URI", () => {
  assert.equal(
    spotifyAppHref({
      uri: "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
      kind: "album",
      id: "2up3OPMp9Tb4dAKM2erWXQ",
      webUrl: "https://open.spotify.com/album/2up3OPMp9Tb4dAKM2erWXQ",
    }),
    "spotify:track:4iV5W9uYEdYUVa79Axb7Rh",
  );
});

test("builds app links from Spotify object types and ids", () => {
  assert.equal(
    spotifyAppUri("playlist", "37i9dQZF1DXcBWIGoYBM5M"),
    "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M",
  );
  assert.equal(spotifyAppUri("track", "not/a-valid-id"), undefined);
});

test("converts Spotify web and localized web links into app links", () => {
  assert.equal(
    spotifyAppUriFromWebUrl(
      "https://open.spotify.com/album/2up3OPMp9Tb4dAKM2erWXQ?si=test",
    ),
    "spotify:album:2up3OPMp9Tb4dAKM2erWXQ",
  );
  assert.equal(
    spotifyAppUriFromWebUrl(
      "https://open.spotify.com/intl-de/artist/2takcwOaAZWiXQijPHIx7B",
    ),
    "spotify:artist:2takcwOaAZWiXQijPHIx7B",
  );
});

test("never exposes an untrusted fallback URL", () => {
  assert.equal(
    spotifyAppHref({ webUrl: "javascript:alert('nope')" }),
    undefined,
  );
  assert.equal(
    spotifyAppHref({ webUrl: "https://example.com/track/id" }),
    undefined,
  );
});
