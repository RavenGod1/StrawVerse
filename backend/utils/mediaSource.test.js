const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeSourceRequest,
  stripCategorySuffix,
  resolvePlaylistUri,
  hasMediaSources,
  isDirectVideoUrl,
  parseLangRequest,
  sourceLangLabel,
  filterSourcesByLang,
  collectOtherLanguages,
  providerDeclaresOtherLanguages,
} = require("./mediaSource");

test("providerDeclaresOtherLanguages reads the extension statuses", () => {
  // "Multi Audio" and a named language mean the provider has more than SUB/DUB.
  assert.strictEqual(
    providerDeclaresOtherLanguages(["Multi Audio", "HLS"]),
    true,
  );
  assert.strictEqual(providerDeclaresOtherLanguages(["Hindi Dub"]), true);
  assert.strictEqual(providerDeclaresOtherLanguages(["French"]), true);
  // Sub/Dub-only providers never show the OTHERS button.
  assert.strictEqual(
    providerDeclaresOtherLanguages(["Sub & Dub", "HLS"]),
    false,
  );
  assert.strictEqual(
    providerDeclaresOtherLanguages(["Sub & Dub", "Hardsub"]),
    false,
  );
  assert.strictEqual(providerDeclaresOtherLanguages(["English"]), false);
  assert.strictEqual(providerDeclaresOtherLanguages([]), false);
  assert.strictEqual(providerDeclaresOtherLanguages(undefined), false);
});

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

test("isDirectVideoUrl keeps protocol-relative and unparseable media URLs", () => {
  assert.strictEqual(isDirectVideoUrl("//cdn.example/video.mp4"), true);
  assert.strictEqual(isDirectVideoUrl("https://cdn.example/video file.mp4"), true);
});

test("parseLangRequest splits a language request from the app's versions", () => {
  assert.deepStrictEqual(parseLangRequest("lang:Hindi"), {
    lang: "Hindi",
    base: null,
  });
  assert.deepStrictEqual(parseLangRequest("dub"), { lang: null, base: "dub" });
  assert.deepStrictEqual(parseLangRequest(""), { lang: null, base: null });
});

test("stripCategorySuffix removes the version suffix from episode ids", () => {
  assert.strictEqual(stripCategorySuffix("episode-3-sub"), "episode-3");
  assert.strictEqual(stripCategorySuffix("episode-3-dub"), "episode-3");
  assert.strictEqual(stripCategorySuffix("episode-3"), "episode-3");
});

test("sourceLangLabel skips the app's own versions and non-language words", () => {
  assert.strictEqual(sourceLangLabel({ lang: "sub" }), "");
  assert.strictEqual(sourceLangLabel({ type: "dub" }), "");
  assert.strictEqual(sourceLangLabel({ lang: "Multi Audio" }), "");
  assert.strictEqual(sourceLangLabel({ lang: "Hindi" }), "Hindi");
  assert.strictEqual(sourceLangLabel({ name: "Anime Salt Abyss (Hindi)" }), "Hindi");
  // A version combo in the name is not a language.
  assert.strictEqual(
    sourceLangLabel({ name: "Anime World India HLS (SUB + DUB)" }),
    "",
  );
  assert.strictEqual(sourceLangLabel({ name: "Stream (SUB/DUB)" }), "");
  // Some providers only write the language in the source name.
  assert.strictEqual(
    sourceLangLabel({ name: "AniXoHindi Hindi Dub", type: "dub" }),
    "Hindi",
  );
  assert.strictEqual(sourceLangLabel({ name: "Anime World India HLS" }), "");
});

test("filterSourcesByLang keeps the tracks of one language", () => {
  const sources = [
    { url: "a", lang: "Hindi" },
    { url: "b", lang: "English" },
    { url: "c", type: "dub" },
  ];
  assert.deepStrictEqual(
    filterSourcesByLang(sources, "Hindi").map((s) => s.url),
    ["a"],
  );
  assert.deepStrictEqual(
    filterSourcesByLang(sources, "hindi").map((s) => s.url),
    ["a"],
  );
  assert.strictEqual(filterSourcesByLang(sources, "").length, 3);
});

test("collectOtherLanguages lists provider languages with their track counts", () => {
  const languages = collectOtherLanguages({
    sources: [{ lang: "Hindi" }, { lang: "Hindi" }, { lang: "sub" }],
    subtitles: [{ lang: "French" }, { lang: "Hindi" }],
  });
  assert.deepStrictEqual(languages, [
    { key: "hindi", label: "Hindi", sources: 2, subtitles: 1 },
    { key: "french", label: "French", sources: 0, subtitles: 1 },
  ]);
});

test("collectOtherLanguages leaves out the app's own languages", () => {
  // English is the app's DUB and its default subtitle language.
  const languages = collectOtherLanguages({
    sources: [
      { name: "Anime World India HLS (SUB + DUB)", type: "dub" },
      { lang: "English" },
      { lang: "Hindi" },
    ],
    subtitles: [{ lang: "English" }, { lang: "Hindi" }],
  });
  assert.deepStrictEqual(languages, [
    { key: "hindi", label: "Hindi", sources: 1, subtitles: 1 },
  ]);
});

test("collectOtherLanguages finds a language written only in the source name", () => {
  const languages = collectOtherLanguages({
    sources: [{ name: "AniXoHindi Hindi Dub", type: "dub" }],
  });
  assert.deepStrictEqual(languages, [
    { key: "hindi", label: "Hindi", sources: 1, subtitles: 0 },
  ]);
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
