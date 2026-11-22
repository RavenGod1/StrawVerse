const test = require("node:test");
const assert = require("node:assert");
const {
  fetchEpisodeSources: fetchProviderEpisodeSources,
  fetchMovieSources: fetchProviderMovieSources,
} = require("./AnimeManga");

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
