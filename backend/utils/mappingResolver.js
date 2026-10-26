const { logger } = require("./AppLogger");
const { mappingQueryAll, mappingQueryOne } = require("./db");

let cachedProviderMetadata = null;
let lastProviderMetadataFetch = 0;

function invalidateMappingMetadataCache() {
  cachedProviderMetadata = null;
  lastProviderMetadataFetch = 0;
}

/**
 * Universal Provider Discovery:
 * Dynamically aggregates providers from:
 * 1. Live registered scraper extensions (global.Anime_providers, global.Manga_providers)
 * 2. Mapping database provider_metadata table
 * 3. Mapping database SQLite tables (discovering any table with an id & malid column)
 */
async function getMappingProviders(
  mediaType = null,
  { installedOnly = false } = {},
) {
  const now = Date.now();
  if (!cachedProviderMetadata || now - lastProviderMetadataFetch > 30000) {
    try {
      const providersMap = new Map();

      // 1. Live registered scrapers
      if (global.Anime_providers) {
        for (const [key, scraper] of Object.entries(global.Anime_providers)) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
          providersMap.set(cleanKey, {
            table_name: cleanKey,
            media_type: "Anime",
            display_name: scraper?.name || key,
          });
        }
      }
      if (global.Manga_providers) {
        for (const [key, scraper] of Object.entries(global.Manga_providers)) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
          providersMap.set(cleanKey, {
            table_name: cleanKey,
            media_type: "Manga",
            display_name: scraper?.name || key,
          });
        }
      }

      // 2. Mapping DB metadata
      if (global.mappingDb) {
        try {
          const rows = await mappingQueryAll(
            "SELECT table_name, media_type, display_name FROM provider_metadata",
          );
          if (rows && rows.length > 0) {
            for (const row of rows) {
              const cleanKey = (row.table_name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              if (providersMap.has(cleanKey)) {
                Object.assign(providersMap.get(cleanKey), row);
              } else {
                providersMap.set(cleanKey, {
                  table_name: row.table_name,
                  media_type: row.media_type,
                  display_name: row.display_name || row.table_name,
                });
              }
            }
          }
        } catch (_) {}

        // 3. Mapping DB tables from sqlite_master
        try {
          const tableRows = await mappingQueryAll(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('unmapped_items', 'provider_metadata', 'anime', 'manga', 'anime_titles', 'manga_titles', 'version_history')",
          );
          if (tableRows && tableRows.length > 0) {
            for (const t of tableRows) {
              const cleanKey = t.name.toLowerCase().replace(/[^a-z0-9]/g, "");
              if (!providersMap.has(cleanKey)) {
                providersMap.set(cleanKey, {
                  table_name: t.name,
                  media_type: null,
                  display_name: t.name,
                });
              }
            }
          }
        } catch (_) {}
      }

      if (providersMap.size > 0) {
        cachedProviderMetadata = Array.from(providersMap.values());
        lastProviderMetadataFetch = now;
      }
    } catch (_) {}
  }

  let list = cachedProviderMetadata ? [...cachedProviderMetadata] : [];

  if (mediaType) {
    const targetType = String(mediaType).toLowerCase();
    list = list.filter(
      (p) => (p.media_type || "").toLowerCase() === targetType,
    );
  }

  if (installedOnly) {
    const installedAnime = new Set(
      Object.keys(global.Anime_providers || {}).map((k) =>
        k.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ),
    );
    const installedManga = new Set(
      Object.keys(global.Manga_providers || {}).map((k) =>
        k.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ),
    );

    list = list.filter((p) => {
      const cleanTbl = (p.table_name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const isAnime = (p.media_type || "").toLowerCase() === "anime";
      const installedSet = isAnime ? installedAnime : installedManga;
      if (installedSet.has(cleanTbl)) return true;
      for (const inst of installedSet) {
        if (inst.includes(cleanTbl) || cleanTbl.includes(inst)) return true;
      }
      return false;
    });
  }

  return list;
}

async function resolveMalIdFromMapping({
  id,
  provider = null,
  mediaType = null,
  installedOnly = false,
}) {
  if (!id || !global.mappingDb) return null;
  const cleanId = String(id).trim();
  if (!cleanId) return null;

  try {
    const providers = await getMappingProviders(mediaType, { installedOnly });
    if (!providers || providers.length === 0) return null;

    if (provider && provider !== "provider" && provider !== "local source") {
      const cleanProv = String(provider)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const matched = providers.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          tbl === cleanProv ||
          tbl.includes(cleanProv) ||
          cleanProv.includes(tbl)
        );
      });

      if (matched) {
        const tbl = matched.table_name;
        const sql =
          tbl === "pahe"
            ? `SELECT malid FROM ${tbl} WHERE id = ? OR uuid = ? LIMIT 1`
            : `SELECT malid FROM ${tbl} WHERE id = ? LIMIT 1`;
        const params =
          tbl === "pahe"
            ? [cleanId, cleanId]
            : [cleanId];
        const row = await mappingQueryOne(sql, params);
        return row?.malid ? Number(row.malid) : null;
      }
    }

    for (const p of providers) {
      try {
        const sql =
          p.table_name === "pahe"
            ? `SELECT malid FROM ${p.table_name} WHERE id = ? OR uuid = ? LIMIT 1`
            : `SELECT malid FROM ${p.table_name} WHERE id = ? LIMIT 1`;
        const params =
          p.table_name === "pahe"
            ? [cleanId, cleanId]
            : [cleanId];
        const row = await mappingQueryOne(sql, params);
        if (row?.malid) return Number(row.malid);
      } catch (_) {}
    }
  } catch (err) {
    logger.error(`[mappingResolver] Error resolving MAL ID: ${err.message}`);
  }

  return null;
}

async function getLinkedProvidersForMalId(
  malid,
  mediaType,
  {
    currentProvider = null,
    currentId = null,
    title = "",
    installedOnly = true,
  } = {},
) {
  const linkedMap = {};

  if (
    currentProvider &&
    currentProvider !== "provider" &&
    currentProvider !== "local source" &&
    currentId
  ) {
    linkedMap[currentProvider.toLowerCase()] = {
      id: String(currentId),
      provider: currentProvider,
      title: title || "",
      folder_name: null,
    };
  }

  if (!malid || !global.mappingDb) {
    return Object.values(linkedMap);
  }

  const numMalId = Number(malid);
  if (isNaN(numMalId) || numMalId <= 0) {
    return Object.values(linkedMap);
  }

  try {
    const providers = await getMappingProviders(mediaType, { installedOnly });

    for (const p of providers) {
      const pNameLower = p.table_name.toLowerCase();
      if (linkedMap[pNameLower]) continue;

      const selectCol = p.table_name === "pahe" ? "id, uuid" : "id";
      const row = await mappingQueryOne(
        `SELECT ${selectCol} FROM ${p.table_name} WHERE malid = ? LIMIT 1`,
        [numMalId],
      );

      if (row) {
        const resolvedId = p.table_name === "pahe" ? (row.id || row.uuid) : row.id;
        if (resolvedId) {
          linkedMap[pNameLower] = {
            id: String(resolvedId),
            provider: p.table_name,
            title: title || "",
            folder_name: null,
          };
        }
      }
    }
  } catch (err) {
    logger.error(
      `[mappingResolver] Error fetching linked providers: ${err.message}`,
    );
  }

  return Object.values(linkedMap);
}

async function getBestProviderForMalId(
  malid,
  mediaType,
  preferredProvider = null,
) {
  if (!malid || !global.mappingDb) return null;
  const numMalId = Number(malid);
  if (isNaN(numMalId) || numMalId <= 0) return null;

  try {
    const providers = await getMappingProviders(mediaType, {
      installedOnly: true,
    });
    if (providers.length === 0) return null;

    const prefLower = (preferredProvider || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (prefLower) {
      const preferredMeta = providers.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          tbl === prefLower ||
          tbl.includes(prefLower) ||
          prefLower.includes(tbl)
        );
      });
      if (preferredMeta) {
        const selectCol = preferredMeta.table_name === "pahe" ? "id, uuid" : "id";
        const row = await mappingQueryOne(
          `SELECT ${selectCol} FROM ${preferredMeta.table_name} WHERE malid = ? LIMIT 1`,
          [numMalId],
        );
        if (row) {
          const resolvedId = preferredMeta.table_name === "pahe" ? (row.id || row.uuid) : row.id;
          if (resolvedId) {
            return {
              id: String(resolvedId),
              provider: preferredMeta.table_name,
            };
          }
        }
      }
    }

    for (const p of providers) {
      const selectCol = p.table_name === "pahe" ? "id, uuid" : "id";
      const row = await mappingQueryOne(
        `SELECT ${selectCol} FROM ${p.table_name} WHERE malid = ? LIMIT 1`,
        [numMalId],
      );
      if (row) {
        const resolvedId = p.table_name === "pahe" ? (row.id || row.uuid) : row.id;
        if (resolvedId) {
          return { id: String(resolvedId), provider: p.table_name };
        }
      }
    }
  } catch (err) {
    logger.error(
      `[mappingResolver] Error finding best provider: ${err.message}`,
    );
  }

  return null;
}

module.exports = {
  getMappingProviders,
  resolveMalIdFromMapping,
  getLinkedProvidersForMalId,
  getBestProviderForMalId,
  invalidateMappingMetadataCache,
};
