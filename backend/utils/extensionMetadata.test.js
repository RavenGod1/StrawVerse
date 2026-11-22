const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeExtensionStatuses,
  normalizeGitHubRawUrl,
} = require("./extensionMetadata");

test("normalizes optional extension statuses", () => {
  assert.deepEqual(
    normalizeExtensionStatuses([
      "  Hindi Dub  ",
      "HD",
      "hindi dub",
      42,
      "",
    ]),
    ["Hindi Dub", "HD"],
  );
});

test("caps extension status count and label length", () => {
  const statuses = normalizeExtensionStatuses([
    "A".repeat(50),
    ...Array.from({ length: 10 }, (_, index) => `Status ${index}`),
  ]);

  assert.equal(statuses.length, 6);
  assert.equal(statuses[0].length, 32);
});

test("ignores a missing or invalid status list", () => {
  assert.deepEqual(normalizeExtensionStatuses(undefined), []);
  assert.deepEqual(normalizeExtensionStatuses("Hindi Dub"), []);
});

test("canonicalizes GitHub raw branch paths to avoid stale CDN objects", () => {
  assert.equal(
    normalizeGitHubRawUrl(
      "https://raw.githubusercontent.com/RavenGod1/extensions/refs/heads/Test/marketplace.json",
    ),
    "https://raw.githubusercontent.com/RavenGod1/extensions/Test/marketplace.json",
  );
  assert.equal(
    normalizeGitHubRawUrl(
      "https://raw.githubusercontent.com/RavenGod1/extensions/Test/marketplace.json",
    ),
    "https://raw.githubusercontent.com/RavenGod1/extensions/Test/marketplace.json",
  );
});
