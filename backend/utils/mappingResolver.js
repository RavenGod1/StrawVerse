const { logger } = require("./AppLogger");
const { mappingQueryAll, mappingQueryOne } = require("./db");

let cachedProviderMetadata = null;
let lastProviderMetadataFetch = 0;

function invalidateMappingMetadataCache() {
  cachedProviderMetadata = null;
  lastProviderMetadataFetch = 0;
}

const DEFAULT_PROVIDERS = [
  {
    table_name: "pahe",
    media_type: "Anime",
    primary_key_field: "uuid",
    display_name: "AnimePahe",
  },
  {
    table_name: "anikoto",
    media_type: "Anime",
    primary_key_field: "id",
    display_name: "Anikoto",
  },
  {
    table_name: "anineko",
    media_type: "Anime",
    primary_key_field: "id",
    display_name: "Anineko",
  },
  {
    table_name: "weebcentral",
    media_type: "Manga",
    primary_key_field: "id",
    display_name: "WeebCentral",
  },
  {
    table_name: "asurascans",
    media_type: "Manga",
    primary_key_field: "id",
    display_name: "AsuraScans",
  },
  {
    table_name: "comix",
    media_type: "Manga",
    primary_key_field: "id",
    display_name: "Comix",
  },
  {
    table_name: "mangafire",
    media_type: "Manga",
    primary_key_field: "id",
    display_name: "MangaFire",
  },
];

async function getMappingProviders(
  mediaType = null,
  { installedOnly = false } = {},
) {
  const now = Date.now();
  if (!cachedProviderMetadata || now - lastProviderMetadataFetch > 30000) {
    try {
      if (global.mappingDb) {
        const rows = await mappingQueryAll(
          "SELECT table_name, media_type, primary_key_field, display_name FROM provider_metadata",
        );
        if (rows && rows.length > 0) {
          cachedProviderMetadata = rows;
          lastProviderMetadataFetch = now;
        }
      }
    } catch (_) {}
  }

  let list =
    cachedProviderMetadata && cachedProviderMetadata.length > 0
      ? [...cachedProviderMetadata]
      : [...DEFAULT_PROVIDERS];

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
        const keyField = matched.primary_key_field;
        const sql =
          keyField === "uuid"
            ? `SELECT malid FROM ${tbl} WHERE uuid = ? OR id = ? LIMIT 1`
            : `SELECT malid FROM ${tbl} WHERE id = ? LIMIT 1`;
        const params = keyField === "uuid" ? [cleanId, cleanId] : [cleanId];
        const row = await mappingQueryOne(sql, params);
        return row?.malid ? Number(row.malid) : null;
      }
    }

    const unionParts = [];
    const params = [];
    for (const p of providers) {
      if (p.primary_key_field === "uuid") {
        unionParts.push(
          `SELECT malid FROM ${p.table_name} WHERE uuid = ? OR id = ?`,
        );
        params.push(cleanId, cleanId);
      } else {
        unionParts.push(`SELECT malid FROM ${p.table_name} WHERE id = ?`);
        params.push(cleanId);
      }
    }

    if (unionParts.length === 0) return null;

    const sql = `
      WITH resolved AS (
        ${unionParts.join("\n UNION ALL \n")}
      )
      SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1
    `;
    const row = await mappingQueryOne(sql, params);
    return row?.malid ? Number(row.malid) : null;
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

      const keyField = p.primary_key_field;
      const selectCol = keyField === "uuid" ? "id, uuid" : "id";
      const row = await mappingQueryOne(
        `SELECT ${selectCol} FROM ${p.table_name} WHERE malid = ? LIMIT 1`,
        [numMalId],
      );

      if (row) {
        const resolvedId = keyField === "uuid" ? row.uuid || row.id : row.id;
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
        const keyField = preferredMeta.primary_key_field;
        const selectCol = keyField === "uuid" ? "id, uuid" : "id";
        const row = await mappingQueryOne(
          `SELECT ${selectCol} FROM ${preferredMeta.table_name} WHERE malid = ? LIMIT 1`,
          [numMalId],
        );
        if (row) {
          const resolvedId = keyField === "uuid" ? row.uuid || row.id : row.id;
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
      const keyField = p.primary_key_field;
      const selectCol = keyField === "uuid" ? "id, uuid" : "id";
      const row = await mappingQueryOne(
        `SELECT ${selectCol} FROM ${p.table_name} WHERE malid = ? LIMIT 1`,
        [numMalId],
      );
      if (row) {
        const resolvedId = keyField === "uuid" ? row.uuid || row.id : row.id;
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
