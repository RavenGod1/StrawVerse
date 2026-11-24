const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeSourceRequest,
  resolvePlaylistUri,
  hasMediaSources,
  isDirectVideoUrl,
} = require("./mediaSource");

test("normalizeSourceRequest removes a category suffix from episode ids", () => {
  assert.deepStrictEqual(
    normalizeSourceRequest("tv:123:1:2-dub", "dub"),
    { episodeId: "tv:123:1:2", category: "dub" },
  );
  assert.deepStrictEqual(normalizeSourceRequest("episode-3-sub"), {
    episodeId: "episode-3",
    category: "sub",
  });
  assert.deepStrictEqual(normalizeSourceRequest("movie:42-hsub"), {
    episodeId: "movie:42",
    category: "hsub",
  });
  assert.deepStrictEqual(normalizeSourceRequest("movie:42-both"), {
    episodeId: "movie:42",
    category: null,
  });
});

test("hasMediaSources ignores empty provider results", () => {
  assert.strictEqual(hasMediaSources(null), false);
  assert.strictEqual(hasMediaSources({ sources: [], subtitles: [] }), false);
  assert.strictEqual(hasMediaSources({ sub: { sources: [] }, dub: [] }), false);
  assert.strictEqual(hasMediaSources({ sources: [{ url: "https://cdn.test/a" }] }), true);
  assert.strictEqual(hasMediaSources({ dub: { sources: [{ url: "https://cdn.test/b" }] } }), true);
  assert.strictEqual(hasMediaSources({ hsub: [{ url: "https://cdn.test/c" }] }), true);
});

test("isDirectVideoUrl recognizes Abyss range-stream URLs", () => {
  assert.strictEqual(
    isDirectVideoUrl("https://weifxopsn26.sssrr.org/sora/708094739/token"),
    true,
  );
  assert.strictEqual(
    isDirectVideoUrl("https://cdn.example/video.mp4?token=abc"),
    true,
  );
  assert.strictEqual(
    isDirectVideoUrl("https://cdn.example/sora/708094739/token"),
    false,
  );
  assert.strictEqual(isDirectVideoUrl("not a url"), false);
});

test("resolvePlaylistUri resolves root-relative HLS URIs from the origin", () => {
  const master =
    "https://play.example/cdn/hls/hash/master.m3u8?md5=token&expires=123";
  assert.strictEqual(
    resolvePlaylistUri("/hls/media-token", master),
    "https://play.example/hls/media-token",
  );
  assert.strictEqual(
    resolvePlaylistUri("variant.m3u8", master),
    "https://play.example/cdn/hls/hash/variant.m3u8",
  );
  assert.strictEqual(
    resolvePlaylistUri("https://cdn.example/segment.ts", master),
    "https://cdn.example/segment.ts",
  );
});
