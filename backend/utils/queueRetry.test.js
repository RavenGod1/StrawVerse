const test = require("node:test");
const assert = require("node:assert");
const { isRetryableError } = require("./queueRetry");

test("empty source results use the queue retry budget", () => {
  assert.strictEqual(
    isRetryableError(
      new Error(
        "NO_SOURCES_AVAILABLE: No stream sources were returned by provider for this episode.",
      ),
    ),
    true,
  );
  assert.strictEqual(
    isRetryableError(
      new Error("Failed To Download: NO_SOURCES_AVAILABLE: resolver temporarily down"),
    ),
    true,
  );
});

test("cancelled and paused queue work is not retried", () => {
  assert.strictEqual(isRetryableError(new Error("Episode Cancelled")), false);
  assert.strictEqual(isRetryableError(new Error("Queue Paused")), false);
});
