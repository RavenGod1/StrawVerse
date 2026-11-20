const test = require("node:test");
const assert = require("node:assert");

const settings = new Map();
const settingKey = (table, key) => `${table}.${key}`;

// Stub the database before loading the updater so these tests exercise its
// real setting reads without requiring an initialized application database.
const dbPath = require.resolve("./db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getKeyValue: async (table, key) =>
      settings.has(settingKey(table, key))
        ? settings.get(settingKey(table, key))
        : null,
    setKeyValue: async (table, key, value) => {
      settings.set(settingKey(table, key), value);
    },
    mappingQueryAll: async () => [],
    mappingQueryOne: async () => null,
    mappingRun: async () => ({ changes: 0 }),
    mappingExec: async () => {},
    batchRun: async () => {},
    queryAll: async () => [],
    queryOne: async () => null,
    run: async () => ({ changes: 0 }),
  },
};

const mappingUpdaterPath = require.resolve("./mappingUpdater");
delete require.cache[mappingUpdaterPath];
const {
  parseSyncIntervalHours,
  getSyncIntervalHours,
  shouldAutoSyncMapping,
} = require("./mappingUpdater");

test.beforeEach(() => settings.clear());

test("parseSyncIntervalHours: default, off, and hour values", () => {
  // Missing or unusable values fall back to the hourly default.
  assert.equal(parseSyncIntervalHours(undefined), 1);
  assert.equal(parseSyncIntervalHours(null), 1);
  assert.equal(parseSyncIntervalHours(""), 1);
  assert.equal(parseSyncIntervalHours("abc"), 1);
  assert.equal(parseSyncIntervalHours(-3), 1);
  // 0 is a valid setting: the scheduled timer is off.
  assert.equal(parseSyncIntervalHours(0), 0);
  assert.equal(parseSyncIntervalHours("0"), 0);
  // Hours pass through; fractional input floors.
  assert.equal(parseSyncIntervalHours(1), 1);
  assert.equal(parseSyncIntervalHours("3"), 3);
  assert.equal(parseSyncIntervalHours(2.7), 2);
});

test("mapping interval is read from persisted settings", async () => {
  settings.set(settingKey("Settings", "mappingSyncIntervalHours"), 3);
  assert.equal(await getSyncIntervalHours(), 3);

  settings.set(settingKey("Settings", "mappingSyncIntervalHours"), 0);
  assert.equal(await getSyncIntervalHours(), 0);
});

test("mapping interval controls the freshness window", async () => {
  settings.set(settingKey("Settings", "mappingSyncIntervalHours"), 3);
  settings.set(
    settingKey("Settings", "mappingLastSyncAnime"),
    Date.now() - 2 * 60 * 60 * 1000,
  );
  assert.equal(await shouldAutoSyncMapping("Anime"), false);

  settings.set(
    settingKey("Settings", "mappingLastSyncAnime"),
    Date.now() - 4 * 60 * 60 * 1000,
  );
  assert.equal(await shouldAutoSyncMapping("Anime"), true);
});

test("startup toggles and the freshness window are honored", async () => {
  settings.set(settingKey("Settings", "mappingAutoSyncAnime"), false);
  assert.equal(await shouldAutoSyncMapping("Anime"), false);

  settings.clear();
  settings.set(settingKey("Settings", "mappingAutoSyncAnime"), true);
  settings.set(settingKey("Settings", "mappingSyncIntervalHours"), 1);
  settings.set(settingKey("Settings", "mappingLastSyncAnime"), Date.now());
  assert.equal(await shouldAutoSyncMapping("Anime"), false);
});

test("scheduled mapping sync ignores the startup-only toggles", async () => {
  settings.set(settingKey("Settings", "mappingAutoSyncAnime"), false);
  settings.set(settingKey("Settings", "mappingAutoSyncManga"), false);
  assert.equal(
    await shouldAutoSyncMapping("Anime", { scheduled: true }),
    true,
  );
  assert.equal(
    await shouldAutoSyncMapping("Manga", { scheduled: true }),
    true,
  );
});
