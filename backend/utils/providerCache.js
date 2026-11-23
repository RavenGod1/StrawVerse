const NodeCache = require("node-cache");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getUserDataPath } = require("./constants");

const MEMORY_TTL_SECONDS = 60;
const DURABLE_TTL_MS = 6 * 60 * 60 * 1000;
const memoryCache = new NodeCache({
  stdTTL: MEMORY_TTL_SECONDS,
  checkperiod: MEMORY_TTL_SECONDS,
});
const inFlight = new Map();
let durableWriteQueue = Promise.resolve();

function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}

function getDurableCachePath() {
  const configuredDir = process.env.STRAWVERSE_PROVIDER_CACHE_DIR;
  return path.join(
    configuredDir || getUserDataPath(),
    "provider-cache.json",
  );
}

async function readDurableIndex() {
  try {
    const raw = await fs.promises.readFile(getDurableCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return {};
    return parsed.entries;
  } catch (_) {
    return {};
  }
}

async function writeDurableIndex(entries) {
  const target = getDurableCachePath();
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.writeFile(
    temp,
    JSON.stringify({ version: 1, entries }),
    "utf8",
  );
  await fs.promises.rename(temp, target);
}

function queueDurableWrite(update) {
  durableWriteQueue = durableWriteQueue
    .catch(() => {})
    .then(async () => {
      const entries = await readDurableIndex();
      const now = Date.now();
      for (const [key, entry] of Object.entries(entries)) {
        if (!entry || Number(entry.expiresAt) <= now) delete entries[key];
      }
      update(entries, now);
      await writeDurableIndex(entries);
    })
    .catch(() => {});
  return durableWriteQueue;
}

function isCacheableProviderResponse(value) {
  if (!value || typeof value !== "object") return false;
  if (value.error || value.errors || value.success === false) return false;
  const status = Number(value.status || value.statusCode || value.httpStatus || 0);
  if (status >= 400) return false;

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    return false;
  }
  if (
    /cf-chl-|cf_chl_|challenge-platform|just a moment|attention required|cloudflare ray id|cf_clearance/i.test(
      serialized,
    )
  ) {
    return false;
  }
  if (/https?:\/\/[^\s"']+\.m3u8(?:[?#][^\s"']*)?|\/m3u8(?:[?#]|$)/i.test(serialized)) {
    return false;
  }
  return true;
}

async function getDurableProviderResponse(key, ttlMs = DURABLE_TTL_MS) {
  const entries = await readDurableIndex();
  const entry = entries[hashKey(key)];
  if (!entry || Number(entry.expiresAt) <= Date.now()) return undefined;
  return entry.data;
}

async function getCachedProviderResponse(key, loader, options = {}) {
  const memory = memoryCache.get(key);
  if (memory !== undefined) return memory;

  const durable = await getDurableProviderResponse(key, options.ttlMs);
  if (durable !== undefined) {
    memoryCache.set(key, durable, MEMORY_TTL_SECONDS);
    return durable;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const data = await loader();
    const cacheable =
      typeof options.cacheable === "function"
        ? options.cacheable(data)
        : isCacheableProviderResponse(data);
    if (cacheable && isCacheableProviderResponse(data)) {
      memoryCache.set(key, data, MEMORY_TTL_SECONDS);
      const ttlMs = Number(options.ttlMs) || DURABLE_TTL_MS;
      await queueDurableWrite((entries, now) => {
        entries[hashKey(key)] = { expiresAt: now + ttlMs, data };
      });
    }
    return data;
  })();
  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

function coalesceProviderRequest(key, loader) {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = Promise.resolve().then(loader);
  inFlight.set(key, promise);
  return promise.finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
}

async function removeDurableProviderResponse(key) {
  memoryCache.del(key);
  await queueDurableWrite((entries) => {
    delete entries[hashKey(key)];
  });
}

module.exports = {
  DURABLE_TTL_MS,
  coalesceProviderRequest,
  getCachedProviderResponse,
  isCacheableProviderResponse,
  removeDurableProviderResponse,
};
