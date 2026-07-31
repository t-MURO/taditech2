import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETE_RELEASE_CACHE_MAX_AGE_MS,
  loadCachedReleaseScan,
  normalizeReleaseBatch,
  PARTIAL_RELEASE_CACHE_MAX_AGE_MS,
  readCachedReleaseBatch,
  releaseCacheIsFresh,
  writeCachedReleaseBatch,
  writeCachedReleaseSnapshot,
} from "./release-cache.ts";

const fetchedAt = "2026-07-30T10:00:00.000Z";

function release(overrides = {}) {
  return {
    id: "release-id",
    name: "Release",
    album_type: "album",
    release_date: "2026-07-30",
    release_date_precision: "day",
    total_tracks: 10,
    images: [{ url: "cover.jpg", width: 640, height: 640 }],
    artists: [{
      id: "artist-id",
      name: "Artist",
      external_urls: { spotify: "https://open.spotify.com/artist/artist-id" },
    }],
    external_urls: {
      spotify: "https://open.spotify.com/album/release-id",
    },
    ...overrides,
  };
}

function batch(overrides = {}) {
  return {
    releases: [release()],
    artistCount: 24,
    scannedArtists: 8,
    nextCursor: "next-page",
    complete: false,
    fetchedAt,
    ...overrides,
  };
}

function installMemoryCacheStorage() {
  const stores = new Map();
  const caches = {
    async open(name) {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          async delete(request) {
            return entries.delete(request.url);
          },
          async keys() {
            return Array.from(entries.keys(), (url) => new Request(url));
          },
          async match(request) {
            return entries.get(request.url)?.clone();
          },
          async put(request, response) {
            entries.set(request.url, response.clone());
          },
        });
      }
      return stores.get(name);
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      caches,
      location: { origin: "https://cache.test" },
    },
  });

  return () => {
    delete globalThis.window;
  };
}

test("strictly normalizes a release batch and discards unknown fields", () => {
  assert.deepEqual(
    normalizeReleaseBatch({
      ...batch(),
      access_token: "must-not-be-cached",
      releases: [{
        ...release(),
        refresh_token: "must-not-be-cached",
      }],
    }),
    batch(),
  );
});

test("rejects malformed releases, dates, cursors, and counters", () => {
  assert.equal(
    normalizeReleaseBatch(batch({
      releases: [release({ release_date: "2026-02-30" })],
    })),
    null,
  );
  assert.equal(
    normalizeReleaseBatch(batch({ complete: true, nextCursor: "still-more" })),
    null,
  );
  assert.equal(
    normalizeReleaseBatch(batch({ scannedArtists: -1 })),
    null,
  );
  assert.equal(
    normalizeReleaseBatch(batch({ fetchedAt: "not-a-date" })),
    null,
  );
  assert.equal(
    normalizeReleaseBatch(batch({ fetchedAt: "2026-07-30" })),
    null,
  );
});

test("accepts Spotify month- and year-precision release dates", () => {
  assert.ok(normalizeReleaseBatch(batch({
    releases: [release({
      release_date: "2026-07",
      release_date_precision: "month",
    })],
  })));
  assert.ok(normalizeReleaseBatch(batch({
    releases: [release({
      release_date: "2026",
      release_date_precision: "year",
    })],
  })));
});

test("keeps complete cache for seven days and partial cache for one day", () => {
  const now = Date.parse(fetchedAt);
  const completeFresh = normalizeReleaseBatch(batch({
    complete: true,
    nextCursor: null,
    fetchedAt: new Date(
      now - COMPLETE_RELEASE_CACHE_MAX_AGE_MS,
    ).toISOString(),
  }));
  const partialFresh = normalizeReleaseBatch(batch({
    fetchedAt: new Date(
      now - PARTIAL_RELEASE_CACHE_MAX_AGE_MS,
    ).toISOString(),
  }));
  assert.ok(completeFresh);
  assert.ok(partialFresh);
  assert.equal(releaseCacheIsFresh([completeFresh], true, now), true);
  assert.equal(releaseCacheIsFresh([partialFresh], false, now), true);

  const completeStale = normalizeReleaseBatch(batch({
    complete: true,
    nextCursor: null,
    fetchedAt: new Date(
      now - COMPLETE_RELEASE_CACHE_MAX_AGE_MS - 1,
    ).toISOString(),
  }));
  const partialStale = normalizeReleaseBatch(batch({
    fetchedAt: new Date(
      now - PARTIAL_RELEASE_CACHE_MAX_AGE_MS - 1,
    ).toISOString(),
  }));
  assert.ok(completeStale);
  assert.ok(partialStale);
  assert.equal(releaseCacheIsFresh([completeStale], true, now), false);
  assert.equal(releaseCacheIsFresh([partialStale], false, now), false);
});

test("loads a completed scan from one compact snapshot", async () => {
  const cleanup = installMemoryCacheStorage();
  try {
    const snapshot = batch({
      releases: [
        release({ id: "newer", release_date: "2026-07-30" }),
        release({ id: "older", release_date: "2026-07-01" }),
      ],
      nextCursor: null,
      complete: true,
    });
    assert.equal(
      await writeCachedReleaseSnapshot("snapshot-account", snapshot),
      true,
    );
    assert.equal(
      await writeCachedReleaseSnapshot(
        "partial-account",
        batch({ complete: false }),
      ),
      false,
    );

    const restored = await loadCachedReleaseScan(
      "snapshot-account",
      Date.parse(fetchedAt),
    );
    assert.deepEqual(restored, snapshot);
  } finally {
    cleanup();
  }
});

test("rejects cache timestamps from the future", () => {
  const now = Date.parse(fetchedAt);
  const minorClockSkew = normalizeReleaseBatch(batch({
    fetchedAt: new Date(now + 60_000).toISOString(),
  }));
  const future = normalizeReleaseBatch(batch({
    fetchedAt: new Date(now + 10 * 60_000).toISOString(),
  }));
  assert.ok(minorClockSkew);
  assert.ok(future);
  assert.equal(releaseCacheIsFresh([minorClockSkew], false, now), true);
  assert.equal(releaseCacheIsFresh([future], false, now), false);
});

test("rebuilds and resumes a cached cursor chain without crossing accounts", async () => {
  const cleanup = installMemoryCacheStorage();
  try {
    const firstPage = batch({
      releases: [release({ id: "first" })],
      nextCursor: "page-two",
    });
    assert.equal(
      await writeCachedReleaseBatch("account-a", null, firstPage),
      true,
    );

    const partial = await loadCachedReleaseScan(
      "account-a",
      Date.parse(fetchedAt),
    );
    assert.equal(partial?.complete, false);
    assert.equal(partial?.nextCursor, "page-two");
    assert.deepEqual(partial?.releases.map(({ id }) => id), ["first"]);
    assert.equal(
      await loadCachedReleaseScan("account-b", Date.parse(fetchedAt)),
      null,
    );

    const finalPage = batch({
      releases: [release({ id: "second" })],
      scannedArtists: 3,
      nextCursor: null,
      complete: true,
      fetchedAt: "2026-07-30T10:01:00.000Z",
    });
    assert.equal(
      await writeCachedReleaseBatch("account-a", "page-two", finalPage),
      true,
    );

    const complete = await loadCachedReleaseScan(
      "account-a",
      Date.parse("2026-07-30T10:02:00.000Z"),
    );
    assert.equal(complete?.complete, true);
    assert.equal(complete?.nextCursor, null);
    assert.equal(complete?.scannedArtists, 11);
    assert.equal(complete?.fetchedAt, finalPage.fetchedAt);
    assert.deepEqual(
      complete?.releases.map(({ id }) => id).sort(),
      ["first", "second"],
    );
  } finally {
    cleanup();
  }
});

test("rejects and clears a cyclic cached cursor chain", async () => {
  const cleanup = installMemoryCacheStorage();
  try {
    await writeCachedReleaseBatch(
      "cyclic-account",
      null,
      batch({ nextCursor: "page-a" }),
    );
    await writeCachedReleaseBatch(
      "cyclic-account",
      "page-a",
      batch({ nextCursor: "page-b" }),
    );
    await writeCachedReleaseBatch(
      "cyclic-account",
      "page-b",
      batch({ nextCursor: "page-a" }),
    );

    assert.equal(
      await loadCachedReleaseScan("cyclic-account", Date.parse(fetchedAt)),
      null,
    );
    assert.equal(
      await readCachedReleaseBatch("cyclic-account", null),
      null,
    );
  } finally {
    cleanup();
  }
});
