const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "strawverse-source-cache-"),
);
process.env.STRAWVERSE_PROVIDER_CACHE_DIR = tempDir;

const {
  animeinfo: fetchProviderAnimeInfo,
  fetchEpisodeSources: fetchProviderEpisodeSources,
  fetchMovieSources: fetchProviderMovieSources,
} = require("./AnimeManga");

test.after(() => {
  fs.rmSync(tempDir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
  delete process.env.STRAWVERSE_PROVIDER_CACHE_DIR;
});

test("identical anime detail requests share one provider call", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const provider = {
    provider_name: `coalesced-anime-info-${Date.now()}`,
    provider: {
      async AnimeInfo() {
        calls++;
        await gate;
        return { id: "anime-1", title: "Anime" };
      },
    },
  };

  const first = fetchProviderAnimeInfo(provider, null, "anime-1");
  const second = fetchProviderAnimeInfo(provider, null, "anime-1");
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test("empty anime source results are not cached", async () => {
  let calls = 0;
  const provider = {
    provider_name: `empty-anime-source-${Date.now()}`,
    provider: {
      async fetchEpisodeSources() {
        calls++;
        return calls === 1
          ? { sources: [], subtitles: [] }
          : { sources: [{ url: "https://cdn.test/episode.m3u8" }] };
      },
    },
  };

  const first = await fetchProviderEpisodeSources(provider, "tv:1:1:1", null);
  const second = await fetchProviderEpisodeSources(provider, "tv:1:1:1", null);
  assert.strictEqual(first.sources.length, 0);
  assert.strictEqual(second.sources.length, 1);
  assert.strictEqual(calls, 2);
});

test("empty movie source results are not cached", async () => {
  let calls = 0;
  const provider = {
    provider_name: `empty-movie-source-${Date.now()}`,
    provider: {
      async fetchMovieSources() {
        calls++;
        return calls === 1
          ? { sources: [], subtitles: [] }
          : { sources: [{ url: "https://cdn.test/movie.m3u8" }] };
      },
    },
  };

  const first = await fetchProviderMovieSources(provider, "movie:1", null);
  const second = await fetchProviderMovieSources(provider, "movie:1", null);
  assert.strictEqual(first.sources.length, 0);
  assert.strictEqual(second.sources.length, 1);
  assert.strictEqual(calls, 2);
});
