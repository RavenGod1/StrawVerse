const test = require("node:test");
const assert = require("node:assert");
const { getDownloadConcurrencyPolicy } = require("./domainConcurrency");
const {
  registerExtension,
  unregisterExtension,
} = require("./extensionRegistry");
const { downloader } = require("./downloader");

test("protected CDN downloads start serially and stay capped", () => {
  registerExtension({
    name: "cdn-policy-test",
    bypassDomains: ["protected-cdn.test"],
  });
  try {
    assert.deepStrictEqual(
      getDownloadConcurrencyPolicy(
        "https://media.protected-cdn.test/segment.ts",
        "https://embed.protected-cdn.test/player",
        8,
        16,
      ),
      { initial: 1, max: 4, isProtected: true },
    );
    assert.deepStrictEqual(
      getDownloadConcurrencyPolicy("https://ordinary-cdn.test/segment.ts", null, 8, 16),
      { initial: 8, max: 16, isProtected: false },
    );
  } finally {
    unregisterExtension("cdn-policy-test");
  }
});

test("CDN clearance success is not reused for another host", async () => {
  const previousBypass = global.cloudflarebypass;
  const calls = [];
  global.cloudflarebypass = async (target) => {
    calls.push(target);
    return target.startsWith("https://allowed-one.test/");
  };
  try {
    const client = new downloader({
      directory: "",
      streamUrl: "https://allowed-one.test/master.m3u8",
    });
    let allowedAttempts = 0;
    const result = await client.fetchWithClearanceRetry(
      "https://allowed-one.test/segment.ts",
      async () => {
        allowedAttempts++;
        if (allowedAttempts === 1) {
          const error = new Error("forbidden");
          error.response = { status: 403 };
          throw error;
        }
        return Buffer.from("ok");
      },
    );
    assert.strictEqual(result.toString(), "ok");

    let blockedAttempts = 0;
    await assert.rejects(
      client.fetchWithClearanceRetry(
        "https://blocked-two.test/segment.ts",
        async () => {
          blockedAttempts++;
          const error = new Error("forbidden");
          error.response = { status: 403 };
          throw error;
        },
      ),
      /forbidden/,
    );
    assert.strictEqual(blockedAttempts, 1);
    assert.deepStrictEqual(calls, [
      "https://allowed-one.test/",
      "https://blocked-two.test/",
    ]);
  } finally {
    if (previousBypass === undefined) delete global.cloudflarebypass;
    else global.cloudflarebypass = previousBypass;
  }
});
