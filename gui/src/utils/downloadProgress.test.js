import test from "node:test";
import assert from "node:assert/strict";
import { getDownloadProgress } from "./downloadProgress.js";

test("uses segment progress for multi-part downloads", () => {
  assert.equal(
    getDownloadProgress({ currentSegments: 3, totalSegments: 4 }),
    75,
  );
});

test("uses direct-video percentage from the caption when segments are unresolved", () => {
  assert.equal(
    getDownloadProgress({
      caption: "Downloading EP 2 (480p) (51%)",
      currentSegments: 0,
      totalSegments: 1,
    }),
    51,
  );
});

test("keeps completed progress at 100 percent", () => {
  assert.equal(
    getDownloadProgress({
      caption: "Video download complete!",
      currentSegments: 1,
      totalSegments: 1,
    }),
    100,
  );
});
