import assert from "node:assert/strict";
import test from "node:test";

import {
  groupReleasesByMonth,
  releaseMonth,
} from "./release-data.ts";

test("maps Spotify day- and month-precision dates to the same month", () => {
  assert.deepEqual(releaseMonth("2026-07-30"), {
    key: "2026-07",
    label: "July 2026",
  });
  assert.deepEqual(releaseMonth("2026-07"), {
    key: "2026-07",
    label: "July 2026",
  });
});

test("gives year-precision and unknown dates honest fallback groups", () => {
  assert.deepEqual(releaseMonth("1999"), {
    key: "1999-00",
    label: "1999 (month unspecified)",
  });
  assert.deepEqual(releaseMonth("2026-13-01"), {
    key: "unknown",
    label: "Release date unknown",
  });
  assert.deepEqual(releaseMonth(null), {
    key: "unknown",
    label: "Release date unknown",
  });
});

test("groups releases while preserving caller-controlled order", () => {
  const julyFirst = { id: "july-first", release_date: "2026-07-30" };
  const june = { id: "june", release_date: "2026-06-02" };
  const julySecond = { id: "july-second", release_date: "2026-07-01" };
  const releases = [julyFirst, june, julySecond];

  const groups = groupReleasesByMonth(releases);

  assert.deepEqual(
    groups.map(({ key, releases: monthReleases }) => ({
      key,
      ids: monthReleases.map(({ id }) => id),
    })),
    [
      { key: "2026-07", ids: ["july-first", "july-second"] },
      { key: "2026-06", ids: ["june"] },
    ],
  );
  assert.deepEqual(releases, [julyFirst, june, julySecond]);
});
