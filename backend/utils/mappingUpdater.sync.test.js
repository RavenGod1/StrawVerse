const test = require("node:test");
const assert = require("node:assert/strict");

const posts = [];
const syncVersions = new Map();
const tableCounts = new Map();
const unmappedCounts = new Map();

const Module = require("node:module");
const originalLoad = Module._load;
const fakeAxios = {
  create: () => ({
    post: async (url, payload) => {
      posts.push({ url, payload });
      return { data: { upToDate: true, tables: {} } };
    },
  }),
};

const dbPath = require.resolve("./db");
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getKeyValue: async () => null,
    setKeyValue: async () => {},
    mappingQueryAll: async () => [],
    mappingQueryOne: async (sql, params = []) => {
      if (sql.includes("FROM sync_versions")) {
        return syncVersions.get(params[0]) || null;
      }
      if (sql.includes("COUNT(*) as count FROM unmapped_items")) {
        return { count: unmappedCounts.get(params[0]) || 0 };
      }
      const tableMatch = sql.match(/COUNT\(\*\) as count FROM \"([^\"]+)\"/i);
      if (tableMatch) return { count: tableCounts.get(tableMatch[1]) || 0 };
      return null;
    },
    mappingRun: async () => ({ changes: 0 }),
    mappingExec: async () => {},
    batchRun: async () => {},
    queryAll: async () => [],
    queryOne: async () => null,
    run: async () => ({ changes: 0 }),
  },
};

global.mappingDb = {};
global.Anime_providers = {};
global.Manga_providers = {};

const mappingUpdaterPath = require.resolve("./mappingUpdater");
delete require.cache[mappingUpdaterPath];
Module._load = function (request, parent, isMain) {
  if (request === "axios") return fakeAxios;
  return originalLoad.call(this, request, parent, isMain);
};
let checkForMappingUpdates;
let syncExtensionMapping;
try {
  ({ checkForMappingUpdates, syncExtensionMapping } = require("./mappingUpdater"));
} finally {
  Module._load = originalLoad;
}

test.beforeEach(() => {
  posts.length = 0;
  syncVersions.clear();
  tableCounts.clear();
  unmappedCounts.clear();
});

test("forced anime and manga syncs keep the stored delta cursor", async () => {
  syncVersions.set("anime", { timestamp: 1700000000, row_count: 30826 });
  syncVersions.set("manga", { timestamp: 1700000001, row_count: 87484 });
  syncVersions.set("next_episodes", { timestamp: 1700000002, row_count: 12 });
  tableCounts.set("anime", 30826);
  tableCounts.set("manga", 87484);
  tableCounts.set("next_episodes", 12);

  await checkForMappingUpdates(true);

  assert.equal(posts.length, 1);
  const { tables } = posts[0].payload;
  assert.deepEqual(tables.anime, { timestamp: 1700000000, count: 30826 });
  assert.deepEqual(tables.manga, { timestamp: 1700000001, count: 87484 });
  assert.deepEqual(tables.next_episodes, {
    timestamp: 1700000002,
    count: 12,
  });
});

test("extension mapping sync reuses stored provider metadata", async () => {
  syncVersions.set("animepahe", { timestamp: 1700000010, row_count: 4200 });
  syncVersions.set("unmapped_animepahe", {
    timestamp: 1700000011,
    row_count: 17,
  });
  tableCounts.set("animepahe", 4200);
  unmappedCounts.set("animepahe", 17);

  await syncExtensionMapping("AnimePahe");

  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].payload.tables.animepahe, {
    timestamp: 1700000010,
    count: 4200,
  });
  assert.deepEqual(posts[0].payload.unmapped.animepahe, {
    timestamp: 1700000011,
    count: 17,
  });
});
