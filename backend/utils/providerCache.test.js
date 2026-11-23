const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "strawverse-provider-cache-"),
);
process.env.STRAWVERSE_PROVIDER_CACHE_DIR = tempDir;

const cachePath = require.resolve("./providerCache");
delete require.cache[cachePath];
const {
  coalesceProviderRequest,
  getCachedProviderResponse,
  isCacheableProviderResponse,
} = require("./providerCache");

test.after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.STRAWVERSE_PROVIDER_CACHE_DIR;
});

test("identical in-flight requests share one provider call", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const loader = async () => {
    calls++;
    await gate;
    return { results: [{ id: "one" }] };
  };

  const first = coalesceProviderRequest("same-request", loader);
  const second = coalesceProviderRequest("same-request", loader);
  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test("successful metadata survives a module reload", async () => {
  const key = "durable-catalog";
  let calls = 0;
  const first = await getCachedProviderResponse(key, async () => {
    calls++;
    return { results: [{ id: "persisted" }] };
  });
  assert.equal(calls, 1);

  delete require.cache[cachePath];
  const reloaded = require("./providerCache");
  const second = await reloaded.getCachedProviderResponse(key, async () => {
    calls++;
    return { results: [{ id: "network" }] };
  });

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(second.results[0], { id: "persisted" });
});

test("challenge responses and signed HLS payloads are not cached", async () => {
  assert.equal(
    isCacheableProviderResponse({
      html: "<title>Just a moment...</title><script>challenge-platform</script>",
    }),
    false,
  );
  assert.equal(
    isCacheableProviderResponse({
      sources: [{ url: "https://cdn.test/master.m3u8?t=token" }],
    }),
    false,
  );
  assert.equal(
    isCacheableProviderResponse({ status: 403, data: "blocked" }),
    false,
  );

  let calls = 0;
  const loader = async () => {
    calls++;
    return { error: true, message: "blocked" };
  };
  await getCachedProviderResponse("challenge-response", loader);
  await getCachedProviderResponse("challenge-response", loader);
  assert.equal(calls, 2);
});

test("a caller can reject an otherwise valid empty response", async () => {
  let calls = 0;
  const loader = async () => {
    calls++;
    return { episodes: [] };
  };
  const options = { cacheable: (data) => data.episodes.length > 0 };

  await getCachedProviderResponse("empty-episodes", loader, options);
  await getCachedProviderResponse("empty-episodes", loader, options);
  assert.equal(calls, 2);
});
