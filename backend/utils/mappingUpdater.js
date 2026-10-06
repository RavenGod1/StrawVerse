const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
let app = null;
try {
  app = require("electron").app;
} catch (e) {}
const { logger } = require("./AppLogger");
const { syncDomainConcurrencyFromMappingDb } = require("./domainConcurrency");
const {
  getKeyValue,
  setKeyValue,
  mappingQueryAll,
  mappingQueryOne,
  mappingRun,
  mappingExec,
  closeDb,
  openDb,
  batchRun,
  queryAll,
  queryOne,
  run,
} = require("./db");
const {
  getUserDataPath,
  getOSName,
  sanitizeFolderName,
  isUuid,
} = require("./constants");
const {
  getMappingProviders,
  resolveMalIdFromMapping,
} = require("./mappingResolver");

const userDataPath = getUserDataPath();

async function dropAllTriggers() {
  try {
    const triggers = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='trigger'",
    );
    for (const trigger of triggers) {
      await mappingRun(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to drop triggers: ${e.message}`);
  }
}

async function ensureMappingTablesExist() {
  try {
    await mappingExec(`
      CREATE TABLE IF NOT EXISTS mapping_changelog (
        id INTEGER PRIMARY KEY,
        version TEXT
      )
    `);
  } catch (e) {
    logger.error(
      `[mappingUpdater] Failed to ensure mapping_changelog table exists: ${e.message}`,
    );
  }
}

function deserializeDelta(buffer) {
  let offset = 0;
  if (buffer.length < 1) return { action: "full_sync" };
  const actionFlag = buffer.readUInt8(offset);
  offset += 1;

  if (actionFlag === 0) {
    return { action: "full_sync" };
  }
  if (buffer.length < offset + 2) return { action: "full_sync" };
  const vLen = buffer.readUInt16BE(offset);
  offset += 2;
  if (buffer.length < offset + vLen) return { action: "full_sync" };
  const version = buffer.toString("utf8", offset, offset + vLen);
  offset += vLen;
  if (buffer.length < offset + 4) return { action: "full_sync" };
  const numUpdates = buffer.readUInt32BE(offset);
  offset += 4;

  const tblRevMap = {
    1: "anime",
    2: "pahe",
    3: "anikoto",
    4: "anineko",
    5: "manga",
    6: "weebcentral",
    7: "next_episodes",
    8: "allmanga",
    9: "provider_metadata",
  };
  const actRevMap = { 1: "INSERT", 2: "UPDATE", 3: "DELETE" };

  const updates = [];
  for (let i = 0; i < numUpdates; i++) {
    if (buffer.length < offset + 6) return { action: "full_sync" };
    const id = buffer.readUInt32BE(offset);
    offset += 4;

    const actVal = buffer.readUInt8(offset);
    offset += 1;
    const action = actRevMap[actVal] || "INSERT";

    const tblVal = buffer.readUInt8(offset);
    offset += 1;
    let tbl = tblRevMap[tblVal];
    if (!tbl || tblVal === 255) {
      if (buffer.length < offset + 1) return { action: "full_sync" };
      const tblLen = buffer.readUInt8(offset);
      offset += 1;
      if (buffer.length < offset + tblLen) return { action: "full_sync" };
      tbl = buffer.toString("utf8", offset, offset + tblLen);
      offset += tblLen;
    }

    if (buffer.length < offset + 2) return { action: "full_sync" };
    const rowIdLen = buffer.readUInt16BE(offset);
    offset += 2;

    if (buffer.length < offset + rowIdLen) return { action: "full_sync" };
    const row_id = buffer.toString("utf8", offset, offset + rowIdLen);
    offset += rowIdLen;

    if (buffer.length < offset + 4) return { action: "full_sync" };
    const dataLen = buffer.readUInt32BE(offset);
    offset += 4;

    let data = null;
    if (dataLen > 0) {
      if (buffer.length < offset + dataLen) return { action: "full_sync" };
      data = buffer.toString("utf8", offset, offset + dataLen);
      offset += dataLen;
    }

    updates.push({ id, action, tbl, row_id, data });
  }

  return { action: "delta", version, updates };
}

async function checkForMappingUpdates() {
  const mappingTagKey = "mapping_release_tag";
  let storedTag = await getKeyValue("Settings", mappingTagKey);

  logger.info(
    `[mappingUpdater] Checking for mapping database updates... (local version: ${storedTag || "none"})`,
  );

  let hasNextEpisodesTable = false;
  let hasMappingChangelogTable = false;
  let hasAnimeTable = false;
  try {
    const tablesList = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('next_episodes', 'mapping_changelog', 'anime')",
    );
    const tableNames = (tablesList || []).map((t) => t.name);
    hasNextEpisodesTable = tableNames.includes("next_episodes");
    hasMappingChangelogTable = tableNames.includes("mapping_changelog");
    hasAnimeTable = tableNames.includes("anime");
  } catch (e) {}

  if (!hasAnimeTable) {
    logger.info(
      "[mappingUpdater] Anime table missing in mapping database. Forcing full sync...",
    );
    storedTag = null;
  }

  let hasTriggers = false;
  try {
    const row = await mappingQueryOne(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' LIMIT 1",
    );
    if (row) {
      logger.info(
        "[mappingUpdater] Legacy triggers detected in mapping database. Forcing full sync to clean up database.",
      );
      hasTriggers = true;
    }
  } catch (e) {}

  let isNextEpisodesEmpty = false;
  if (hasNextEpisodesTable) {
    try {
      const row = await mappingQueryOne(
        "SELECT COUNT(*) as count FROM next_episodes",
      );
      if (!row || row.count === 0) {
        isNextEpisodesEmpty = true;
      }
    } catch (e) {
      isNextEpisodesEmpty = true;
    }
  } else {
    isNextEpisodesEmpty = true;
  }

  let lastId = 0;
  if (hasMappingChangelogTable) {
    try {
      const row = await mappingQueryOne(
        "SELECT MAX(id) as maxId FROM mapping_changelog",
      );
      if (row && typeof row.maxId === "number") {
        lastId = row.maxId;
      }
    } catch (e) {}
  }

  let latestVersion = null;
  const osName = getOSName();

  try {
    const vRes = await axios.get(
      "https://strawverse.theyogmehta.online/api/mapping/version",
      {
        headers: {
          os: osName,
        },
      },
    );
    latestVersion = vRes.data?.version;
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to get latest version: ${e.message}`);
  }

  if (
    storedTag &&
    latestVersion &&
    storedTag === latestVersion &&
    !hasTriggers
  ) {
    logger.info(
      `[mappingUpdater] Local mapping database is up to date at version ${storedTag}. Skipping download.`,
    );
    await dropAllTriggers();
    await ensureMappingTablesExist();
    try {
      await syncLibraryIdsWithMapping();
    } catch (syncErr) {}
    return;
  }

  let updateResponse = null;
  try {
    const url = storedTag
      ? `https://strawverse.theyogmehta.online/api/mapping/updates?version=${storedTag}&last_id=${lastId}`
      : `https://strawverse.theyogmehta.online/api/mapping/updates?last_id=${lastId}`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        os: osName,
      },
    });
    const buffer = Buffer.from(response.data);
    updateResponse = deserializeDelta(buffer);
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to check for mapping updates from server: ${err.message}`,
    );
  }

  let action = updateResponse?.action || "full_sync";
  if (!latestVersion && updateResponse?.version) {
    latestVersion = updateResponse.version;
  }
  let updates = updateResponse?.updates || [];

  if (action === "delta" && updates.length > 10000) {
    logger.info(
      `[mappingUpdater] Delta update contains ${updates.length} records. Forcing full sync...`,
    );
    action = "full_sync";
  }

  if (hasTriggers || !hasAnimeTable) {
    action = "full_sync";
  }

  if (action === "full_sync") {
    const downloadUrl =
      "https://strawverse.theyogmehta.online/api/mapping/download";
    const tempDbPath = path.join(userDataPath, "mapping_temp.db");
    const mappingDbPath = path.join(userDataPath, "mapping.db");

    try {
      logger.info(
        `[mappingUpdater] Downloading full mapping database from: ${downloadUrl}`,
      );
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        headers: {
          os: osName,
        },
      });
      const gzippedData = Buffer.from(response.data);

      logger.info("[mappingUpdater] Decompressing mapping database...");
      const decompressedData = await new Promise((resolve, reject) => {
        zlib.gunzip(gzippedData, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      await fs.promises.writeFile(tempDbPath, decompressedData);

      logger.info("[mappingUpdater] Replacing mapping database file...");

      try {
        await closeDb("mapping");
      } catch (closeErr) {
        logger.error(
          `[mappingUpdater] Error closing database connection: ${closeErr.message}`,
        );
      }

      await fs.promises.copyFile(tempDbPath, mappingDbPath);
      await fs.promises.unlink(tempDbPath).catch(() => {});

      await openDb("mapping");
      await dropAllTriggers();
      await ensureMappingTablesExist();

      if (latestVersion) {
        await setKeyValue("Settings", mappingTagKey, latestVersion);
      }
      logger.info(
        `[mappingUpdater] Mapping database successfully updated to version: ${latestVersion || "fallback"}`,
      );
      try {
        await syncLibraryIdsWithMapping();
      } catch (syncErr) {}
    } catch (err) {
      logger.error(
        `[mappingUpdater] Failed to update mapping database: ${err.message}`,
      );
      try {
        await closeDb("mapping");
      } catch (e) {}
      try {
        await openDb("mapping");
        await dropAllTriggers();
      } catch (reopenErr) {
        logger.error(
          `[mappingUpdater] Failed to re-open mapping database after error: ${reopenErr.message}`,
        );
      }
    }
  } else {
    await dropAllTriggers();
    await ensureMappingTablesExist();

    if (action === "delta" && updates.length > 0) {
      logger.info(
        `[mappingUpdater] Applying ${updates.length} delta updates since version ${storedTag}...`,
      );
      try {
        await mappingExec("PRAGMA foreign_keys = OFF");

        const changelogSql =
          "INSERT OR REPLACE INTO mapping_changelog (id, version) VALUES (?, ?)";

        const paheRotations = [];
        const UPDATE_CHUNK_SIZE = 500;
        for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
          const updateChunk = updates.slice(i, i + UPDATE_CHUNK_SIZE);
          const ops = [];

          for (const update of updateChunk) {
            const { id, action: act, tbl, row_id, data } = update;

            const tableCheck = await mappingQueryOne(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
              [tbl],
            );

            if (!tableCheck) {
              ops.push({
                sql: changelogSql,
                params: [id, latestVersion],
              });
              continue;
            }

            if (act === "INSERT" || act === "UPDATE") {
              if (data) {
                const parsedData = JSON.parse(data);

                if (tbl === "pahe" && parsedData.id && parsedData.uuid) {
                  try {
                    const existingPahe = await mappingQueryOne(
                      "SELECT uuid FROM pahe WHERE id = ?",
                      [parsedData.id],
                    );
                    if (
                      existingPahe?.uuid &&
                      existingPahe.uuid.toLowerCase() !==
                        parsedData.uuid.toLowerCase()
                    ) {
                      paheRotations.push({
                        oldUuid: existingPahe.uuid,
                        newUuid: parsedData.uuid,
                        malid: parsedData.malid || null,
                      });
                    }
                  } catch (_) {}
                }

                const tableColsRes = await mappingQueryAll(
                  `PRAGMA table_info(${tbl})`,
                );
                const validCols = new Set(
                  (tableColsRes || []).map((c) => c.name),
                );
                const validKeys = Object.keys(parsedData).filter((k) =>
                  validCols.has(k),
                );

                if (validKeys.length > 0) {
                  const cols = validKeys.join(", ");
                  const placeholders = validKeys.map(() => "?").join(", ");
                  const values = validKeys.map((k) => parsedData[k] ?? null);
                  ops.push({
                    sql: `INSERT OR REPLACE INTO ${tbl} (${cols}) VALUES (${placeholders})`,
                    params: values,
                  });
                }
              }
            } else if (act === "DELETE") {
              if (tbl === "anime" || tbl === "manga") {
                ops.push({
                  sql: `DELETE FROM ${tbl} WHERE malid = ?`,
                  params: [row_id],
                });
              } else if (tbl === "next_episodes") {
                const parts = row_id.split("_");
                const livechartId = parts[0];
                const episode = parseInt(parts[1], 10);
                ops.push({
                  sql: "DELETE FROM next_episodes WHERE livechart_id = ? AND episode = ?",
                  params: [
                    livechartId ?? null,
                    isNaN(episode) ? null : episode,
                  ],
                });
              } else if (tbl === "provider_metadata") {
                ops.push({
                  sql: "DELETE FROM provider_metadata WHERE table_name = ?",
                  params: [row_id],
                });
              } else {
                ops.push({
                  sql: `DELETE FROM ${tbl} WHERE id = ?`,
                  params: [row_id],
                });
              }
            }

            ops.push({
              sql: changelogSql,
              params: [id, latestVersion],
            });
          }

          if (ops.length > 0) {
            await batchRun("mapping", ops);
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        if (paheRotations.length > 0) {
          for (const rot of paheRotations) {
            try {
              await run(
                "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
                [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
              );
              await run(
                "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
              );
              await run(
                "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
              );
              await run(
                "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
                [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
              );
              if (rot.malid) {
                await run(
                  "UPDATE Anime SET MalID = ? WHERE (id = ? OR id LIKE ?) AND (MalID IS NULL OR MalID = '')",
                  [String(rot.malid), rot.newUuid, `${rot.newUuid}-%`],
                );
              }
              if (typeof global.sendToRenderer === "function") {
                global.sendToRenderer("anime-id-updated", {
                  oldId: rot.oldUuid,
                  newId: rot.newUuid,
                  provider: "pahe",
                  mediaType: "Anime",
                });
              }
              logger.info(
                `[mappingUpdater] Healed rotated AnimePahe UUID via delta: ${rot.oldUuid} -> ${rot.newUuid}`,
              );
            } catch (rotErr) {
              logger.error(
                `[mappingUpdater] Error applying delta UUID rotation ${rot.oldUuid} -> ${rot.newUuid}: ${rotErr.message}`,
              );
            }
          }
        }

        await mappingExec("PRAGMA foreign_keys = ON");

        if (latestVersion) {
          await setKeyValue("Settings", mappingTagKey, latestVersion);
        }
        logger.info(
          `[mappingUpdater] Mapping database successfully updated via delta to version: ${latestVersion}`,
        );
        try {
          await syncLibraryIdsWithMapping();
        } catch (syncErr) {}
      } catch (err) {
        logger.error(
          `[mappingUpdater] Failed to apply delta updates: ${err.message}`,
        );
        try {
          await mappingExec("PRAGMA foreign_keys = ON");
        } catch (e) {}
      }
    } else {
      logger.info("[mappingUpdater] Mapping database is up to date.");
      if (latestVersion && latestVersion !== storedTag) {
        await setKeyValue("Settings", mappingTagKey, latestVersion);
        logger.info(
          `[mappingUpdater] Updated client version tag to: ${latestVersion}`,
        );
      }
      try {
        await syncLibraryIdsWithMapping();
      } catch (syncErr) {}
    }
  }
}

async function syncLibraryIdsWithMapping() {
  try {
    // 1. Sync Anime
    const animeProviders = await getMappingProviders("Anime");
    const localAnimeList = await queryAll(
      "SELECT id, MalID, malid, provider, title, folder_name FROM Anime",
    );
    for (const anime of localAnimeList || []) {
      let rawMalId = anime.MalID || anime.malid;
      let malid =
        rawMalId && !isNaN(Number(rawMalId)) && Number(rawMalId) > 0
          ? Number(rawMalId)
          : null;
      const provider = (anime.provider || "").toLowerCase();

      if (!malid) {
        try {
          const unlinkedRow = await queryOne(
            "SELECT malid FROM unlinked_mal_ids WHERE id = ? OR id LIKE ? LIMIT 1",
            [anime.id, `${anime.id}-%`],
          );
          if (unlinkedRow?.malid && !isNaN(Number(unlinkedRow.malid))) {
            malid = Number(unlinkedRow.malid);
          }
        } catch (_) {}
      }

      if (!malid && (anime.title || anime.folder_name)) {
        try {
          const candidates = [anime.title, anime.folder_name].filter(Boolean);
          for (const cand of candidates) {
            const malRow = await queryOne(
              "SELECT id FROM MyAnimeList WHERE LOWER(title) = LOWER(?) LIMIT 1",
              [cand],
            );
            if (malRow?.id && !isNaN(Number(malRow.id))) {
              malid = Number(malRow.id);
              break;
            }
          }
        } catch (_) {}
      }

      if (!malid) {
        try {
          const resolved = await resolveMalIdFromMapping({
            id: anime.id,
            provider,
            mediaType: "Anime",
          });
          if (resolved && !isNaN(Number(resolved))) {
            malid = Number(resolved);
          }
        } catch (_) {}
      }

      if (malid && !rawMalId) {
        try {
          await run("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?", [
            String(malid),
            anime.id,
            `${anime.id}-%`,
          ]);
        } catch (_) {}
      }

      const cleanProv = provider.replace(/[^a-z0-9]/g, "");
      let matched = animeProviders.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          cleanProv &&
          (tbl === cleanProv ||
            tbl.includes(cleanProv) ||
            cleanProv.includes(tbl))
        );
      });

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
          anime.id,
        );
      if (!matched) {
        if (isUuid) {
          matched = animeProviders.find(
            (p) =>
              (p.primary_key_field || "").toLowerCase() === "uuid" ||
              p.table_name === "pahe",
          );
        } else if (!provider || provider === "local source") {
          matched = animeProviders.find((p) => p.table_name === "pahe");
        }
      }
      if (!matched) continue;

      const targetTable = matched.table_name;
      const useUuid =
        (matched.primary_key_field || "").toLowerCase() === "uuid";

      let targetRow = null;
      if (malid) {
        const query = useUuid
          ? `SELECT id, uuid, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`
          : `SELECT id, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`;
        targetRow = await mappingQueryOne(query, [malid]);
      }
      if (!targetRow) {
        const query = useUuid
          ? `SELECT id, uuid, malid FROM ${targetTable} WHERE id = ? OR uuid = ? LIMIT 1`
          : `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`;
        targetRow = useUuid
          ? await mappingQueryOne(query, [anime.id, anime.id])
          : await mappingQueryOne(query, [anime.id]);
      }

      if (targetRow) {
        const latestId = useUuid
          ? targetRow.uuid || targetRow.id
          : targetRow.id;
        if (latestId && latestId !== anime.id) {
          const existingFolder =
            anime.folder_name ||
            (anime.title ? sanitizeFolderName(anime.title) : anime.id);
          try {
            await run(
              "UPDATE Anime SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id LIKE ?",
              [existingFolder, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          await run(
            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          await run(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          await run(
            "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          try {
            await run(
              "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          try {
            await run(
              "UPDATE OR REPLACE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          if (targetRow.malid || malid) {
            const saveMalId = String(targetRow.malid || malid);
            await run("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?", [
              saveMalId,
              latestId,
              `${latestId}-%`,
            ]);
          }

          try {
            if (typeof global.sendToRenderer === "function") {
              global.sendToRenderer("anime-id-updated", {
                oldId: anime.id,
                newId: latestId,
                provider: anime.provider || targetTable,
                mediaType: "Anime",
              });
            }
          } catch (_) {}
        }
      }
    }

    // 2. Sync Manga
    const mangaProviders = await getMappingProviders("Manga");
    const localMangaList = await queryAll(
      "SELECT id, MalID, malid, provider, title, folder_name FROM Manga",
    );
    for (const manga of localMangaList || []) {
      let rawMalId = manga.MalID || manga.malid;
      let malid =
        rawMalId && !isNaN(Number(rawMalId)) && Number(rawMalId) > 0
          ? Number(rawMalId)
          : null;
      const provider = (manga.provider || "").toLowerCase();

      if (!malid) {
        try {
          const unlinkedRow = await queryOne(
            "SELECT malid FROM unlinked_mal_ids WHERE id = ? LIMIT 1",
            [manga.id],
          );
          if (unlinkedRow?.malid && !isNaN(Number(unlinkedRow.malid))) {
            malid = Number(unlinkedRow.malid);
          }
        } catch (_) {}
      }

      if (!malid && (manga.title || manga.folder_name)) {
        try {
          const candidates = [manga.title, manga.folder_name].filter(Boolean);
          for (const cand of candidates) {
            const malRow = await queryOne(
              "SELECT id FROM MyMangaList WHERE LOWER(title) = LOWER(?) LIMIT 1",
              [cand],
            );
            if (malRow?.id && !isNaN(Number(malRow.id))) {
              malid = Number(malRow.id);
              break;
            }
          }
        } catch (_) {}
      }

      if (!malid) {
        try {
          const resolved = await resolveMalIdFromMapping({
            id: manga.id,
            provider,
            mediaType: "Manga",
          });
          if (resolved && !isNaN(Number(resolved))) {
            malid = Number(resolved);
          }
        } catch (_) {}
      }

      if (malid && !rawMalId) {
        try {
          await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
            String(malid),
            manga.id,
          ]);
        } catch (_) {}
      }

      const cleanProv = provider.replace(/[^a-z0-9]/g, "");
      let matched = mangaProviders.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          cleanProv &&
          (tbl === cleanProv ||
            tbl.includes(cleanProv) ||
            cleanProv.includes(tbl))
        );
      });
      if (!matched) continue;

      const targetTable = matched.table_name;
      const useUuid =
        (matched.primary_key_field || "").toLowerCase() === "uuid";

      let targetRow = null;
      if (malid) {
        const query = useUuid
          ? `SELECT id, uuid, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`
          : `SELECT id, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`;
        targetRow = await mappingQueryOne(query, [malid]);
      }
      if (!targetRow) {
        const query = useUuid
          ? `SELECT id, uuid, malid FROM ${targetTable} WHERE id = ? OR uuid = ? LIMIT 1`
          : `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`;
        targetRow = useUuid
          ? await mappingQueryOne(query, [manga.id, manga.id])
          : await mappingQueryOne(query, [manga.id]);
      }

      if (targetRow) {
        const latestId = useUuid
          ? targetRow.uuid || targetRow.id
          : targetRow.id;
        if (latestId && latestId !== manga.id) {
          const existingFolder =
            manga.folder_name ||
            (manga.title ? sanitizeFolderName(manga.title) : manga.id);
          try {
            await run(
              "UPDATE Manga SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ?",
              [existingFolder, manga.id],
            );
          } catch (_) {}

          await run(
            "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
            [manga.id, latestId, manga.id],
          );

          await run(
            "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
            [manga.id, latestId, manga.id],
          );

          try {
            await run(
              "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [manga.id, latestId, manga.id],
            );
          } catch (_) {}

          try {
            await run(
              "UPDATE OR REPLACE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [manga.id, latestId, manga.id],
            );
          } catch (_) {}

          if (targetRow.malid || malid) {
            const saveMalId = String(targetRow.malid || malid);
            await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
              saveMalId,
              latestId,
            ]);
          }

          try {
            if (typeof global.sendToRenderer === "function") {
              global.sendToRenderer("anime-id-updated", {
                oldId: manga.id,
                newId: latestId,
                provider: manga.provider || targetTable,
                mediaType: "Manga",
              });
            }
          } catch (_) {}
        }
      }
    }

    try {
      const orphanWatchList = await queryAll(
        "SELECT DISTINCT anime_id, anime_title FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
      );
      for (const item of orphanWatchList || []) {
        if (!item.anime_id) continue;
        let malid = null;
        if (item.anime_title) {
          const malRow = await queryOne(
            "SELECT id FROM MyAnimeList WHERE LOWER(title) = LOWER(?) LIMIT 1",
            [item.anime_title],
          );
          if (malRow?.id && !isNaN(Number(malRow.id))) {
            malid = Number(malRow.id);
          }
        }
        if (!malid) {
          try {
            const resolved = await resolveMalIdFromMapping({
              id: item.anime_id,
              mediaType: "Anime",
            });
            if (resolved && !isNaN(Number(resolved))) {
              malid = Number(resolved);
            }
          } catch (_) {}
        }
        if (malid) {
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
              item.anime_id,
            );
          const targetTable = "pahe";
          const targetRow = await mappingQueryOne(
            `SELECT id, uuid, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`,
            [malid],
          );
          if (targetRow) {
            const latestId = isUuid
              ? targetRow.uuid || targetRow.id
              : targetRow.id;
            if (latestId && latestId !== item.anime_id) {
              await run(
                "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [item.anime_id, latestId, item.anime_id, `${item.anime_id}-%`],
              );
              await run(
                "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [item.anime_id, latestId, item.anime_id, `${item.anime_id}-%`],
              );
              try {
                if (typeof global.sendToRenderer === "function") {
                  global.sendToRenderer("anime-id-updated", {
                    oldId: item.anime_id,
                    newId: latestId,
                    provider: targetTable,
                    mediaType: "Anime",
                  });
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}

    if (typeof syncDomainConcurrencyFromMappingDb === "function") {
      await syncDomainConcurrencyFromMappingDb();
    }
  } catch (err) {
    logger.error(`[mappingUpdater] Failed to sync library IDs: ${err.message}`);
  }
}

module.exports = {
  checkForMappingUpdates,
};
