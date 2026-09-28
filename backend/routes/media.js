const express = require("express");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { logger } = require("../utils/AppLogger");
const { settingfetch, providerFetch } = require("../utils/settings");
const {
  latestMangas,
  MangaSearch,
  MangaInfo,
  latestAnime,
  animeinfo,
  animesearch,
  fetchEpisode,
  fetchEpisodeSources,
  MangaChapterFetch,
  fetchChapters,
  getProviderOrThrow,
  processServer,
} = require("../utils/AnimeManga");
const {
  getAllMetadata,
  getSourceById,
  FindMapping,
} = require("../utils/Metadata");
const { getKeyValue, queryOne, run } = require("../utils/db");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { getHeaders } = require("../utils/proxyHeaders");
const axios = require("axios");
const { checkForMappingUpdates } = require("../utils/mappingUpdater");
const {
  resolveMalIdFromMapping,
  getLinkedProvidersForMalId,
  getBestProviderForMalId,
} = require("../utils/mappingResolver");
const { sanitizeFolderName } = require("../utils/constants");

const router = express.Router();

async function enrichResultsWithMappingImages(results, AnimeManga) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return results;
  }

  const isAnime = AnimeManga === "Anime";

  for (const item of results) {
    if (!item) continue;

    item.scraper_image = item.image || null;

    let malid =
      item.MalID || item.malid ? Number(item.MalID || item.malid) : null;

    if (!malid && item.id && global.db) {
      try {
        const table = isAnime ? "Anime" : "Manga";
        const row = await global.db
          .prepare(`SELECT MalID FROM ${table} WHERE id = ?`)
          .get(String(item.id));
        if (row && row.MalID) {
          malid = parseInt(row.MalID);
        }
      } catch (_) {}
    }

    if (!malid && item.id && global.mappingDb) {
      try {
        const resolved = await resolveMalIdFromMapping({
          id: item.id,
          mediaType: isAnime ? "Anime" : "Manga",
        });
        if (resolved) malid = resolved;
      } catch (_) {}
    }

    if (malid) {
      item.malid = malid;
      let remoteImg = null;
      if (global.mappingDb) {
        try {
          const imgRow = await global.mappingDb
            .prepare(
              isAnime
                ? "SELECT image_url FROM anime WHERE malid = ? LIMIT 1"
                : "SELECT image_url FROM manga WHERE malid = ? LIMIT 1",
            )
            .get(malid);
          if (imgRow && imgRow.image_url) {
            remoteImg = imgRow.image_url;
          }
        } catch (_) {}
      }
      if (!remoteImg && global.db) {
        try {
          const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
          const malRow = await global.db
            .prepare(`SELECT image FROM ${listTable} WHERE id = ? LIMIT 1`)
            .get(String(malid));
          if (malRow && malRow.image) {
            remoteImg = malRow.image;
          }
        } catch (_) {}
      }
      if (remoteImg) {
        item.image_url = remoteImg;
        item.image = remoteImg;
        if (item.id && global.db) {
          try {
            const table = isAnime ? "Anime" : "Manga";
            await global.db
              .prepare(`UPDATE ${table} SET image_url = ? WHERE id = ?`)
              .run(remoteImg, item.id);
          } catch (_) {}
        }
      }
    }

    if (!item.image && !item.scraper_image) {
      item.image = "/images/image-404.png";
    }
  }

  return results;
}

// Catalog listing endpoint
router.post("/api/list/:AnimeManga/:provider/", async (req, res) => {
  const { AnimeManga, provider } = req.params;
  let filters = {};

  if (req?.body?.filters && typeof req.body.filters === "object") {
    for (const [key, value] of Object.entries(req.body.filters)) {
      if (value != null && value !== "") {
        const num = Number(value);
        filters[key] = !isNaN(num) ? num : value;
      }
    }
  }

  try {
    if (!AnimeManga || !provider) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const config = await settingfetch();
    let data = null;

    if (AnimeManga === "Anime") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Anime",
          config?.CustomDownloadLocation,
          filters?.page,
          filters?.tag,
        );
      } else if (provider === "provider") {
        const pObj = await getProviderOrThrow("Anime");
        data = await latestAnime(pObj, filters);
        data = { ...data, site: config.Animeprovider };
      } else if (provider === "search") {
        const pObj = await getProviderOrThrow("Anime");
        data = await animesearch(
          pObj,
          req?.query?.query || req?.body?.keyword,
          filters,
        );
        data = { ...data, site: config.Animeprovider };
      } else {
        const pObj = await getProviderOrThrow("Anime", provider);
        const searchKeyword = req?.body?.keyword || req?.query?.query || "";
        if (searchKeyword) {
          data = await animesearch(pObj, searchKeyword, filters);
        } else {
          data = await latestAnime(pObj, filters);
        }
        data = { ...data, site: provider };
      }
    } else if (AnimeManga === "Manga") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Manga",
          config?.CustomDownloadLocation,
          filters?.page,
          filters?.tag,
        );
      } else if (provider === "provider") {
        const pObj = await getProviderOrThrow("Manga");
        data = await latestMangas(pObj, filters?.page);
      } else if (provider === "search") {
        const pObj = await getProviderOrThrow("Manga");
        data = await MangaSearch(
          pObj,
          req?.query?.query || req?.body?.keyword,
          filters?.page,
        );
      } else {
        const pObj = await getProviderOrThrow("Manga", provider);
        const searchKeyword = req?.body?.keyword || req?.query?.query || "";
        if (searchKeyword) {
          data = await MangaSearch(pObj, searchKeyword, filters?.page);
        } else {
          data = await latestMangas(pObj, filters?.page);
        }
      }
    }

    if (!data) throw new Error(`No ${AnimeManga} Found in ${provider}`);

    if (data?.results && data.results.length > 0) {
      try {
        await enrichResultsWithMappingImages(data.results, AnimeManga);
      } catch (_) {}

      try {
        if (provider === "local") {
          const orderKey = `custom_order_${AnimeManga}_local_${filters?.tag || "all"}`;
          const savedOrder = await getKeyValue("Settings", orderKey);
          if (
            savedOrder &&
            Array.isArray(savedOrder) &&
            savedOrder.length > 0
          ) {
            const orderMap = new Map();
            savedOrder.forEach((id, idx) => orderMap.set(id, idx));
            data.results.sort((a, b) => {
              const indexA = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
              const indexB = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
              return indexA - indexB;
            });
          }
        }
      } catch (_) {}
    }

    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${provider} ${AnimeManga} page ${filters?.page}`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.json({
      totalPages: 0,
      currentPage: 1,
      hasNextPage: false,
      totalItems: 0,
      results: [],
      error: true,
      message: err.message,
      extension_missing: err?.message?.includes("Missing Provider!"),
    });
  }
});

// Weekly episode schedule
router.get("/api/schedule/weekly", async (req, res) => {
  try {
    const localToday = new Date();
    const todayStart =
      new Date(
        localToday.getFullYear(),
        localToday.getMonth(),
        localToday.getDate(),
        0,
        0,
        0,
      ).getTime() / 1000;
    const yesterdayStart = todayStart - 24 * 3600;
    const limitEnd = todayStart + 7 * 24 * 3600;

    const episodes = await global.mappingDb
      .prepare(
        `
        SELECT ne.livechart_id, ne.episode, ne.date, ne.title, COALESCE(a.image_url, ne.image, '/images/image-404.png') AS image, ne.image AS scraper_image, a.malid
        FROM next_episodes ne
        LEFT JOIN anime a ON ne.livechart_id = a.livechart_id
        WHERE ne.date >= ? AND ne.date <= ?
        GROUP BY ne.livechart_id, DATE(ne.date, 'unixepoch')
        ORDER BY ne.date ASC
      `,
      )
      .all(yesterdayStart, limitEnd);

    res.json({
      results: episodes,
      updating: !!global.livechart_updating,
    });
  } catch (err) {
    logger.error(`Error in /api/schedule/weekly: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

async function healAnimePaheUuid({ oldId, malid, title, folderName }) {
  if (!oldId) return null;
  const cleanOldId = String(oldId).trim();

  let mappingRow = null;
  let resolvedMalId = malid ? Number(malid) : null;

  if (global.db) {
    try {
      const animeRow = await global.db
        .prepare(
          "SELECT MalID, title, folder_name FROM Anime WHERE id = ? OR id LIKE ?",
        )
        .get(cleanOldId, `${cleanOldId}-%`);
      if (animeRow) {
        if (!resolvedMalId && animeRow.MalID) {
          resolvedMalId = Number(animeRow.MalID);
        }
        if (!title && animeRow.title) title = animeRow.title;
        if (!folderName && animeRow.folder_name)
          folderName = animeRow.folder_name;
      }
    } catch (_) {}
  }

  // Check local mappingDb for the active entry
  if (global.mappingDb) {
    try {
      if (resolvedMalId) {
        mappingRow = await global.mappingDb
          .prepare("SELECT id, uuid, malid FROM pahe WHERE malid = ? LIMIT 1")
          .get(resolvedMalId);
      } else {
        mappingRow = await global.mappingDb
          .prepare("SELECT id, uuid, malid FROM pahe WHERE id = ? LIMIT 1")
          .get(cleanOldId);
      }
      if (mappingRow?.malid && !resolvedMalId) {
        resolvedMalId = Number(mappingRow.malid);
      }
    } catch (_) {}
  }

  let newId = null;
  if (mappingRow?.uuid && mappingRow.uuid !== cleanOldId) {
    newId = mappingRow.uuid;
  }

  if (!newId || newId === cleanOldId) {
    if (typeof global.sendToRenderer === "function") {
      global.sendToRenderer("info-loading-status", {
        text: "Auto-healing AnimePahe UUID from directory, please wait...",
      });
    }

    try {
      let html = "";
      const paheMirrors = [
        "https://animepahe.ng",
        "https://animepahe.ch",
        "https://animepahe.pw",
        "https://animepahe.com",
        "https://animepahe.org",
      ];
      for (const mirror of paheMirrors) {
        if (html) break;
        if (typeof global.scrapperFetch === "function") {
          try {
            html = await global.scrapperFetch(`${mirror}/anime`);
          } catch (_) {}
        }
        if (!html && global.axios) {
          try {
            const res = await global.axios.get(`${mirror}/anime`, {
              headers: { Referer: `${mirror}/` },
              timeout: 20000,
            });
            html = typeof res.data === "string" ? res.data : "";
          } catch (_) {}
        }
      }

      const links = [];
      let tsv = "";
      if (html) {
        const linkRegex =
          /<a\s+[^>]*href="\/anime\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = linkRegex.exec(html)) !== null) {
          const u = m[1].toLowerCase().trim();
          const n = (m[2] || "")
            .replace(/<[^>]+>/g, "")
            .replace(/[\r\n\t]+/g, " ")
            .trim();
          if (u && n) {
            links.push({ uuid: u, name: n });
            tsv += `${u}\t${n}\n`;
          }
        }
      }

      if (links.length > 0) {
        const client = global.axios || axios;
        const syncRes = await client
          .post(
            "https://strawverse.theyogmehta.online/api/pahe/index",
            { brokenUuid: cleanOldId, catalog: tsv, links },
            { timeout: 30000 },
          )
          .catch((err) => {
            logger.error(
              `[pahe-heal] Failed to post index to server: ${err?.message}`,
            );
            return null;
          });

        if (syncRes?.data?.resolvedNewUuid) {
          newId = syncRes.data.resolvedNewUuid;
          logger.info(
            `[pahe-heal] Server auto-healed UUID ${cleanOldId} -> ${newId}`,
          );
        }

        if (typeof global.sendToRenderer === "function") {
          global.sendToRenderer("info-loading-status", {
            text: "Updating database with healed mapping, please wait...",
          });
        }

        await checkForMappingUpdates();

        if (!newId && global.mappingDb) {
          try {
            const recheckRow = resolvedMalId
              ? await global.mappingDb
                  .prepare("SELECT uuid FROM pahe WHERE malid = ?")
                  .get(resolvedMalId)
              : await global.mappingDb
                  .prepare("SELECT uuid FROM pahe WHERE uuid = ? OR id = ?")
                  .get(cleanOldId, cleanOldId);
            if (recheckRow?.uuid && recheckRow.uuid !== cleanOldId) {
              newId = recheckRow.uuid;
            }
          } catch (_) {}
        }

        if (!newId && links.length > 0 && (title || folderName)) {
          const normalize = (s) =>
            (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const cleanTitle = normalize(title);
          const cleanFolder = normalize(folderName);
          const found = links.find((l) => {
            const cleanLinkName = normalize(l.name);
            return (
              (cleanTitle && cleanLinkName === cleanTitle) ||
              (cleanFolder && cleanLinkName === cleanFolder)
            );
          });
          if (found?.uuid && found.uuid !== cleanOldId) {
            newId = found.uuid;
            logger.info(
              `[pahe-heal] Resolved UUID via local name matching (${title || folderName} -> "${found.name}"): ${cleanOldId} -> ${newId}`,
            );
          }
        }
      }
    } catch (err) {
      logger.error(
        `[pahe-heal] Failed to recover from /anime index: ${err.message}`,
      );
    } finally {
      if (typeof global.sendToRenderer === "function") {
        global.sendToRenderer("info-loading-status", { text: "" });
      }
    }
  }

  if (newId && newId !== cleanOldId) {
    if (global.mappingDb && resolvedMalId) {
      try {
        await global.mappingDb
          .prepare(
            "INSERT INTO pahe (id, uuid, malid) VALUES (?, ?, ?) ON CONFLICT(malid) DO UPDATE SET uuid = excluded.uuid, id = excluded.id",
          )
          .run(newId, newId, resolvedMalId);
      } catch (_) {}
    }
    try {
      if (global.db) {
        await global.db
          .prepare(
            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        await global.db
          .prepare(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        await global.db
          .prepare(
            "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        try {
          await global.db
            .prepare(
              "UPDATE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            )
            .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);
        } catch (_) {}
      }

      if (typeof global.sendToRenderer === "function") {
        global.sendToRenderer("anime-id-updated", {
          oldId: cleanOldId,
          newId: newId,
          provider: "pahe",
          mediaType: "Anime",
        });
      }

      logger.info(
        `[pahe-heal] Successfully updated Anime ID from ${cleanOldId} to ${newId}`,
      );
      return newId;
    } catch (dbErr) {
      logger.error(
        `[pahe-heal] Failed to update resolved ID in database: ${dbErr.message}`,
      );
    }
  }

  return null;
}

// Fetches Anime / Manga Info
router.post("/api/info/:AnimeManga/:LocalMalProvider", async (req, res) => {
  const { AnimeManga } = req.params;
  let { LocalMalProvider } = req.params;
  let { id } = req.body;

  const data = {
    MalLoggedIn: !!global?.MalLoggedIn,
  };
  let provider = null;

  const setting = await settingfetch();

  try {
    if (!id) throw new Error("ID IS Missing");

    try {
      const AnimeLocalInfo = await FindMapping(
        AnimeManga,
        id,
        null,
        setting.CustomDownloadLocation,
      );
      if (AnimeLocalInfo && AnimeLocalInfo.id) {
        Object.assign(data, AnimeLocalInfo);
        data.genres = AnimeLocalInfo?.genres
          ? AnimeLocalInfo.genres.split(",")
          : [];
        provider = AnimeLocalInfo?.provider;
      } else {
        throw new Error("Metadata not found locally");
      }
    } catch (err) {
      if (LocalMalProvider === "local") {
        let resolvedId = null;
        let resolvedProvider = null;
        let resolvedMalId = null;

        if (global.db && id) {
          try {
            const unlinkedRow = await global.db
              .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
              .get(id);
            if (unlinkedRow && unlinkedRow.malid) {
              resolvedMalId = parseInt(unlinkedRow.malid);
            }
          } catch (_) {}

          if (!resolvedMalId) {
            try {
              let localRow = await global.db
                .prepare(
                  `SELECT MalID, id, provider FROM ${AnimeManga} WHERE id = ? OR folder_name = ? OR LOWER(title) = LOWER(?) LIMIT 1`,
                )
                .get(id, id, id);
              if (!localRow) {
                const histTable =
                  AnimeManga === "Anime" ? "WatchHistory" : "ReadHistory";
                const idCol = AnimeManga === "Anime" ? "anime_id" : "manga_id";
                const titleCol =
                  AnimeManga === "Anime" ? "anime_title" : "manga_title";
                const histRow = await global.db
                  .prepare(
                    `SELECT ${titleCol} FROM ${histTable} WHERE ${idCol} = ? LIMIT 1`,
                  )
                  .get(id);
                if (histRow && histRow[titleCol]) {
                  localRow = await global.db
                    .prepare(
                      `SELECT MalID, id, provider FROM ${AnimeManga} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
                    )
                    .get(histRow[titleCol]);
                }
              }
              if (localRow) {
                if (localRow.MalID) {
                  resolvedMalId = parseInt(localRow.MalID);
                }
                resolvedId = localRow.id;
                resolvedProvider = localRow.provider || "pahe";
              }
            } catch (_) {}
          }
        }

        if (!resolvedMalId && global.mappingDb && id) {
          try {
            const foundMalId = await resolveMalIdFromMapping({
              id,
              mediaType: AnimeManga,
              installedOnly: true,
            });
            if (foundMalId) {
              resolvedMalId = foundMalId;
              const preferred = (
                AnimeManga === "Anime"
                  ? setting.Animeprovider || "pahe"
                  : setting.Mangaprovider || "weebcentral"
              ).toLowerCase();
              const best = await getBestProviderForMalId(
                resolvedMalId,
                AnimeManga,
                preferred,
              );
              if (best) {
                resolvedId = best.id;
                resolvedProvider = best.provider;
              }
            }
          } catch (_) {}
        }

        if (!resolvedId && AnimeManga === "Anime" && id) {
          try {
            const healedId = await healAnimePaheUuid({ oldId: id });
            if (healedId) {
              resolvedId = healedId;
              resolvedProvider = "pahe";
              if (global.db) {
                const healedRow = await global.db
                  .prepare(
                    "SELECT MalID, id, provider FROM Anime WHERE id = ? LIMIT 1",
                  )
                  .get(healedId);
                if (healedRow) {
                  if (healedRow.MalID)
                    resolvedMalId = parseInt(healedRow.MalID);
                  resolvedProvider = healedRow.provider || "pahe";
                }
              }
            }
          } catch (_) {}
        }

        if (resolvedId && resolvedProvider) {
          resolvedId = String(resolvedId);
          id = resolvedId;
          LocalMalProvider = resolvedProvider;
          provider = resolvedProvider;
          data.id = resolvedId;
          data.provider = resolvedProvider;
          data.malid = resolvedMalId;
        } else {
          throw new Error(`No ${AnimeManga} Found with id '${id}'`);
        }
      } else if (LocalMalProvider === "mal") {
        let resolvedId = null;
        let resolvedProvider = null;
        const targetMalId = Number(id);

        const preferred = (
          AnimeManga === "Anime"
            ? setting.Animeprovider || "pahe"
            : setting.Mangaprovider || "weebcentral"
        ).toLowerCase();

        const best = await getBestProviderForMalId(
          targetMalId,
          AnimeManga,
          preferred,
        );
        if (best) {
          resolvedId = best.id;
          resolvedProvider = best.provider;
        }

        if (resolvedId && resolvedProvider) {
          resolvedId = String(resolvedId);
          id = resolvedId;
          LocalMalProvider = resolvedProvider;
          provider = resolvedProvider;
          data.id = resolvedId;
          data.provider = resolvedProvider;
          data.malid = targetMalId;
        } else {
          throw new Error(
            `This ${AnimeManga.toLowerCase()} is not mapped to any provider yet.`,
          );
        }
      }
    }

    if (
      LocalMalProvider !== "local" ||
      (provider && provider !== "local source")
    ) {
      try {
        if (AnimeManga === "Anime") {
          const Animeprovider = await providerFetch(
            "Anime",
            (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
              ? LocalMalProvider
              : provider) ?? null,
          );
          const lookupId = id;
          let AnimeInfo = null;
          try {
            AnimeInfo = await animeinfo(
              Animeprovider,
              setting?.CustomDownloadLocation,
              lookupId,
              data?.provider ? false : true,
            );
          } catch (fetchErr) {
            logger.warn(
              `Failed to fetch initial online metadata for ${lookupId}: ${fetchErr.message}`,
            );
          }

          if (
            Animeprovider.provider_name === "pahe" &&
            (!AnimeInfo ||
              !AnimeInfo.title ||
              AnimeInfo.results ||
              AnimeInfo.needsMappingSync)
          ) {
            let newId =
              AnimeInfo?.newUuid && AnimeInfo.newUuid !== lookupId
                ? AnimeInfo.newUuid
                : null;
            if (!newId || newId === lookupId) {
              newId = await healAnimePaheUuid({
                oldId: lookupId,
                title: data.title,
                malid: data.malid,
              });
            }
            if (newId && newId !== lookupId) {
              AnimeInfo = await animeinfo(
                Animeprovider,
                setting?.CustomDownloadLocation,
                newId,
                false,
              );
              id = newId;
              data.id = newId;
            }

            if (typeof global.sendToRenderer === "function") {
              global.sendToRenderer("info-loading-status", {
                text: "",
              });
            }
          }

          if (AnimeInfo) {
            Object.assign(data, AnimeInfo);

            try {
              await global.db
                .prepare(
                  `UPDATE Anime SET description = ?, status = ?, genres = ?, aired = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                )
                .run(
                  AnimeInfo.description || "",
                  AnimeInfo.status || "",
                  Array.isArray(AnimeInfo.genres)
                    ? AnimeInfo.genres.join(",")
                    : AnimeInfo.genres || "",
                  AnimeInfo.aired || "",
                  AnimeInfo.image_url || AnimeInfo.image || "",
                  Animeprovider.provider_name,
                  id,
                );
            } catch (dbErr) {
              logger.error(
                `Failed to update local metadata for Anime ${id}: ${dbErr.message}`,
              );
            }
          }
          data.provider = Animeprovider.provider_name;

          if (
            Animeprovider.provider_name === "pahe" &&
            (AnimeInfo?.malid || AnimeInfo?.MalID) &&
            id &&
            global?.mappingDb
          ) {
            try {
              const parsedMalId = Number(AnimeInfo.malid || AnimeInfo.MalID);
              const existingPaheRow = await global.mappingDb
                .prepare(
                  "SELECT id, uuid, malid FROM pahe WHERE uuid = ? OR malid = ? LIMIT 1",
                )
                .get(id, parsedMalId);

              const isMissingOrDiff =
                !existingPaheRow ||
                existingPaheRow.malid !== parsedMalId ||
                existingPaheRow.uuid !== id;

              if (isMissingOrDiff) {
                axios
                  .post(
                    "https://strawverse.theyogmehta.online/api/pahe/report",
                    {
                      uuid: id,
                      id: AnimeInfo.dataId ? String(AnimeInfo.dataId) : null,
                      malid: parsedMalId,
                      name: AnimeInfo.title || null,
                    },
                    { timeout: 5000 },
                  )
                  .catch(() => {});
              }
            } catch (_) {}
          }
        } else if (AnimeManga === "Manga") {
          const Mangaprovider = await providerFetch(
            "Manga",
            (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
              ? LocalMalProvider
              : provider) ?? null,
          );
          const MangaInfoData = await MangaInfo(Mangaprovider, id);
          if (MangaInfoData) {
            Object.assign(data, MangaInfoData);

            try {
              await global.db
                .prepare(
                  `UPDATE Manga SET description = ?, genres = ?, released = ?, author = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                )
                .run(
                  MangaInfoData.description || "",
                  Array.isArray(MangaInfoData.genres)
                    ? MangaInfoData.genres.join(",")
                    : MangaInfoData.genres || "",
                  MangaInfoData.released || "",
                  MangaInfoData.author || "",
                  MangaInfoData.image_url || MangaInfoData.image || "",
                  Mangaprovider.provider_name,
                  id,
                );
            } catch (dbErr) {
              logger.error(
                `Failed to update local metadata for Manga ${id}: ${dbErr.message}`,
              );
            }
          }
          data.provider = Mangaprovider.provider_name;
        }
      } catch (err) {
        if (data && data.id) {
          logger.warn(
            `Failed to fetch online metadata for ${id} (using cached local data): ${err.message}`,
          );
        } else {
          throw err;
        }
      }
    }

    if (data && global.mappingDb) {
      try {
        const customMappingRow = await global.db
          .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
          .get(id);

        let resolvedMalId = undefined;
        let isCustom = false;

        if (customMappingRow) {
          isCustom = true;
          if (customMappingRow.malid) {
            resolvedMalId = parseInt(customMappingRow.malid);
          } else {
            resolvedMalId = null;
          }
        } else if (data.malid) {
          resolvedMalId = parseInt(data.malid);
        }

        let mappingRow = null;
        if (resolvedMalId !== undefined) {
          if (resolvedMalId !== null) {
            data.malid = resolvedMalId;
            if (isCustom) {
              try {
                await global.db
                  .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                  .run(String(resolvedMalId), id);
              } catch (_) {}
            }
          } else {
            data.malid = null;
            if (isCustom) {
              try {
                await global.db
                  .prepare(`UPDATE ${AnimeManga} SET MalID = NULL WHERE id = ?`)
                  .run(id);
              } catch (_) {}
            }
          }
        } else {
          if (!data.malid && global.mappingDb && id) {
            const foundMalId = await resolveMalIdFromMapping({
              id,
              mediaType: AnimeManga,
              installedOnly: true,
            });
            if (foundMalId) {
              data.malid = foundMalId;
              try {
                await global.db
                  .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                  .run(String(data.malid), id);
              } catch (_) {}
            }
          }
        }

        if (data.malid) {
          try {
            const linkedRecords = await global.db
              .prepare(
                `SELECT id, provider, title, folder_name FROM ${AnimeManga} WHERE MalID = ?`,
              )
              .all(String(data.malid));

            const linkedProvidersMap = {};
            linkedRecords.forEach((r) => {
              linkedProvidersMap[r.provider] = {
                id: r.id,
                provider: r.provider,
                title: r.title,
                folder_name: r.folder_name,
              };
            });

            const mappedLinked = await getLinkedProvidersForMalId(
              data.malid,
              AnimeManga,
              {
                currentProvider: data.provider,
                currentId: data.id || id,
                title: data.title || "",
                installedOnly: true,
              },
            );

            mappedLinked.forEach((p) => {
              if (!linkedProvidersMap[p.provider]) {
                linkedProvidersMap[p.provider] = p;
              }
            });

            if (
              data.provider &&
              !linkedProvidersMap[data.provider] &&
              data.provider !== "provider" &&
              data.provider !== "local source"
            ) {
              linkedProvidersMap[data.provider] = {
                id: data.id || id,
                provider: data.provider,
                title: data.title || "",
                folder_name: data.folder_name || null,
              };
            }

            data.linkedProviders = Object.values(linkedProvidersMap);
            if (
              (!data.provider || data.provider === "local source") &&
              data.linkedProviders.length > 0
            ) {
              const activep =
                data.linkedProviders.find(
                  (p) => p.provider && p.provider !== "local source",
                ) || data.linkedProviders[0];
              if (activep) {
                data.provider = activep.provider;
                data.id = activep.id;
              }
            }
          } catch (e) {}

          if (AnimeManga === "Anime") {
            try {
              let livechartId = null;
              if (global.mappingDb) {
                try {
                  const lcRow = await global.mappingDb
                    .prepare(
                      "SELECT livechart_id FROM anime WHERE malid = ? LIMIT 1",
                    )
                    .get(data.malid);
                  if (lcRow?.livechart_id) {
                    livechartId = lcRow.livechart_id;
                  }
                } catch (_) {}
              }

              if (livechartId) {
                const now = Math.floor(Date.now() / 1000);

                let watchedEpisodes = 0;
                try {
                  const watchedRow = await global.db
                    .prepare(
                      "SELECT MAX(episode_number) AS watched_episodes FROM WatchHistory WHERE anime_id = ?",
                    )
                    .get(id);
                  if (watchedRow && watchedRow.watched_episodes) {
                    watchedEpisodes = watchedRow.watched_episodes;
                  }
                } catch (_) {}

                const localToday = new Date();
                const localTodayStart =
                  new Date(
                    localToday.getFullYear(),
                    localToday.getMonth(),
                    localToday.getDate(),
                    0,
                    0,
                    0,
                  ).getTime() / 1000;
                const localYesterdayStart = localTodayStart - 24 * 3600;

                const airedEp = await global.mappingDb
                  .prepare(
                    `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date <= ? 
                    ORDER BY date DESC LIMIT 1
                  `,
                  )
                  .get(livechartId, now);

                const upcomingEp = await global.mappingDb
                  .prepare(
                    `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date > ? 
                    ORDER BY date ASC LIMIT 1
                  `,
                  )
                  .get(livechartId, now);

                let nextEp = upcomingEp;
                let showAired = false;
                if (
                  airedEp &&
                  airedEp.date >= localYesterdayStart &&
                  watchedEpisodes < airedEp.episode
                ) {
                  nextEp = airedEp;
                  showAired = true;
                }

                if (nextEp) {
                  if (showAired) {
                    data.nextEpisodeIn = `Ep ${nextEp.episode}: Aired`;
                  } else {
                    const diff = nextEp.date - now;
                    const minutes = Math.ceil(diff / 60);
                    const hours = Math.ceil(diff / 3600);
                    const days = Math.ceil(diff / (24 * 3600));

                    if (days > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
                    } else if (hours > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
                    } else if (minutes > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${minutes} min${minutes > 1 ? "s" : ""}`;
                    } else {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
                    }
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (mappingErr) {
        logger.error(`Error querying mappingDb: ${mappingErr.message}`);
      }
    }

    if (data.malid && global.MalLoggedIn) {
      try {
        if (AnimeManga === "Anime") {
          const MalInfo = await global.db
            .prepare("SELECT * FROM MyAnimeList WHERE id = ?")
            .get(String(data.malid));
          if (MalInfo) {
            data.watched = MalInfo.watched ?? 0;
            data.malStatus = MalInfo.status ?? "watching";
            if (MalInfo.totalEpisodes > 0) {
              data.totalEpisodes = MalInfo.totalEpisodes;
            }
          }
        } else if (AnimeManga === "Manga") {
          const MalInfo = await global.db
            .prepare("SELECT * FROM MyMangaList WHERE id = ?")
            .get(String(data.malid));
          if (MalInfo) {
            data.watched = MalInfo.read ?? 0;
            data.malStatus = MalInfo.status ?? "plan_to_read";
            if (MalInfo.totalChapters > 0) {
              data.totalChapters = MalInfo.totalChapters;
            }
          }
        }
      } catch (malDbErr) {
        logger.error(
          `Failed to load MAL list stats for resolved malid ${data.malid}: ${malDbErr.message}`,
        );
      }
    }

    try {
      let tagRow = null;
      if (AnimeManga === "Anime") {
        tagRow = await global.db
          .prepare(
            `SELECT CustomTag FROM Anime WHERE id = ? OR folder_name = ?`,
          )
          .get(id, id);
      } else {
        tagRow = await global.db
          .prepare(
            `SELECT CustomTag FROM Manga WHERE id = ? OR folder_name = ?`,
          )
          .get(id, id);
      }

      const targetMalId = data?.malid;
      if (!tagRow?.CustomTag && targetMalId) {
        const malRow = await global.db
          .prepare(
            `SELECT CustomTag FROM ${AnimeManga} WHERE MalID = ? AND CustomTag IS NOT NULL AND CustomTag != ''`,
          )
          .get(String(targetMalId));
        if (malRow && malRow.CustomTag) {
          tagRow = malRow;
        }
      }

      if (tagRow && tagRow.CustomTag) {
        data.CustomTag = tagRow.CustomTag;
      }
    } catch (tagDbErr) {
      logger.error(`Failed to load CustomTag for ${id}: ${tagDbErr.message}`);
    }

    if (data) {
      data.scraper_image = data.image || null;

      if (data.malid) {
        try {
          let remoteImg = null;
          if (global.mappingDb && AnimeManga === "Anime") {
            const imgRow = await global.mappingDb
              .prepare("SELECT image_url FROM anime WHERE malid = ?")
              .get(Number(data.malid));
            if (imgRow && imgRow.image_url) {
              remoteImg = imgRow.image_url;
            }
          }
          if (!remoteImg) {
            const listTable =
              AnimeManga === "Anime" ? "MyAnimeList" : "MyMangaList";
            const malRow = await global.db
              .prepare(
                `SELECT image, main_picture FROM ${listTable} WHERE id = ?`,
              )
              .get(String(data.malid));
            if (malRow) {
              remoteImg = malRow.image || malRow.main_picture;
            }
          }
          if (remoteImg) {
            data.image_url = remoteImg;
            data.image = remoteImg;
            try {
              await global.db
                .prepare(`UPDATE ${AnimeManga} SET image_url = ? WHERE id = ?`)
                .run(remoteImg, id);
            } catch (_) {}
          }
        } catch (_) {}

        const isCjkTitle = (t) => t && !/[a-zA-Z]/.test(t);
        if (
          !data.title ||
          data.title.startsWith("MAL ") ||
          isCjkTitle(data.title)
        ) {
          try {
            const titleRes = await fetch(
              `https://strawverse.theyogmehta.online/api/title/${AnimeManga}/${data.malid}`,
            );
            if (titleRes.ok) {
              const tData = await titleRes.json();
              if (tData && tData.title) {
                data.title = tData.title;
                try {
                  await global.db
                    .prepare(`UPDATE ${AnimeManga} SET title = ? WHERE id = ?`)
                    .run(data.title, id);
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }
    }

    if (!data?.id) throw new Error(`No ${AnimeManga} Found with id '${id}'`);
    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${LocalMalProvider} ${AnimeManga} with AnimeID : '${id}'`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    let localTag = data?.CustomTag || "";
    if (!localTag) {
      try {
        const row = await global.db
          .prepare(`SELECT CustomTag FROM ${AnimeManga} WHERE id = ?`)
          .get(id);
        if (row) localTag = row.CustomTag || "";
      } catch (_) {}
    }
    return res.json({
      error: true,
      message: err?.message,
      CustomTag: localTag,
    });
  }
});

// Fetches Anime Episodes or Manga Chapters
router.post("/api/info/items", async (req, res) => {
  let { id, page, provider, type } = req.body;
  page = parseInt(page ?? 1);
  const isAnime = type === "Anime";
  const fetchFunction = isAnime ? fetchEpisode : fetchChapters;
  const errorName = isAnime ? "Episodes" : "Chapters";

  if (global.db && id) {
    try {
      const table = isAnime ? "Anime" : "Manga";
      const exists = await global.db
        .prepare(`SELECT id FROM ${table} WHERE id = ?`)
        .get(id);
      if (!exists) {
        const histTable = isAnime ? "WatchHistory" : "ReadHistory";
        const idCol = isAnime ? "anime_id" : "manga_id";
        const titleCol = isAnime ? "anime_title" : "manga_title";
        const hist = await global.db
          .prepare(
            `SELECT ${titleCol} FROM ${histTable} WHERE ${idCol} = ? LIMIT 1`,
          )
          .get(id);
        if (hist && hist[titleCol]) {
          const actual = await global.db
            .prepare(
              `SELECT id FROM ${table} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
            )
            .get(hist[titleCol]);
          if (actual && actual.id) id = actual.id;
        }
      }
    } catch (_) {}
  }

  try {
    if (isNaN(page)) throw new Error(`invalid Page '${page}'`);
    if (!id) throw new Error("ID is Missing");

    if (provider !== "local source") {
      const providerObj = await providerFetch(type, provider ?? null);
      let data = null;
      try {
        data = await fetchFunction(providerObj, id, page);
        if (
          isAnime &&
          (providerObj.provider_name === "pahe" || provider === "pahe") &&
          page === 1 &&
          (!data?.episodes || data.episodes.length === 0)
        ) {
          const emptyErr = new Error(
            "AnimePahe returned 404 or empty episodes",
          );
          emptyErr.status = 404;
          throw emptyErr;
        }
      } catch (fetchErr) {
        if (
          isAnime &&
          (providerObj.provider_name === "pahe" || provider === "pahe") &&
          (fetchErr?.response?.status === 404 ||
            fetchErr?.status === 404 ||
            fetchErr?.message?.includes("404"))
        ) {
          let animeTitle = null;
          let animeFolderName = null;
          let animeMalId = null;
          if (global.db) {
            try {
              const aRow = await global.db
                .prepare(
                  "SELECT title, folder_name, MalID FROM Anime WHERE id = ? OR id LIKE ?",
                )
                .get(id, `${id}-%`);
              if (aRow) {
                animeTitle = aRow.title;
                animeFolderName = aRow.folder_name;
                animeMalId = aRow.MalID;
              }
            } catch (_) {}
          }
          const healedId = await healAnimePaheUuid({
            oldId: id,
            title: animeTitle,
            folderName: animeFolderName,
            malid: animeMalId,
          });
          if (healedId) {
            logger.info(
              `[api/info/items] Retrying episode fetch with healed id: ${id} -> ${healedId}`,
            );
            data = await fetchFunction(providerObj, healedId, page);
          } else {
            throw fetchErr;
          }
        } else {
          throw fetchErr;
        }
      }
      if (!data) throw new Error(`No ${errorName} Found`);
      if (data.hasNextPage === undefined && data.totalPages !== undefined) {
        data.hasNextPage = page < data.totalPages;
      }

      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    logger.error(`Error Fetching '${id}' ${errorName} page : ${page}:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return res.json({ error: true, message: err?.message });
  }
});

// Play Video From m3u8 url
router.post("/api/watch", async (req, res) => {
  const { ep, epNum, Downloaded, provider = null, subdub } = req.body;
  try {
    if (!Downloaded) {
      if (!ep) throw new Error("Episode ID Not Found");
      const Animeprovider = await providerFetch("Anime", provider);
      let sourcesArray = await fetchEpisodeSources(Animeprovider, ep, subdub);

      if (sourcesArray) {
        const prefSubDub = subdub || "sub";
        let rawSources = [];
        if (
          prefSubDub &&
          Array.isArray(sourcesArray[prefSubDub]?.sources) &&
          sourcesArray[prefSubDub].sources.length > 0
        ) {
          rawSources = sourcesArray[prefSubDub].sources;
        } else if (
          prefSubDub &&
          Array.isArray(sourcesArray[prefSubDub]) &&
          sourcesArray[prefSubDub].length > 0
        ) {
          rawSources = sourcesArray[prefSubDub];
        } else if (
          Array.isArray(sourcesArray.sources) &&
          sourcesArray.sources.length > 0
        ) {
          rawSources = sourcesArray.sources;
        } else {
          const subSrcs = Array.isArray(sourcesArray.sub?.sources)
            ? sourcesArray.sub.sources
            : Array.isArray(sourcesArray.sub)
              ? sourcesArray.sub
              : [];
          const dubSrcs = Array.isArray(sourcesArray.dub?.sources)
            ? sourcesArray.dub.sources
            : Array.isArray(sourcesArray.dub)
              ? sourcesArray.dub
              : [];
          const hsubSrcs = Array.isArray(sourcesArray.hsub?.sources)
            ? sourcesArray.hsub.sources
            : Array.isArray(sourcesArray.hsub)
              ? sourcesArray.hsub
              : [];

          rawSources = [...subSrcs, ...dubSrcs, ...hsubSrcs];
        }

        const isHSub = (s) =>
          s.isHsub ||
          s.type === "hsub" ||
          s.quality?.toLowerCase().includes("hsub");
        const isDub = (s) =>
          s.isDub ||
          s.type === "dub" ||
          s.quality?.toLowerCase().includes("dub");

        let mainSources = rawSources;
        if (prefSubDub === "sub") {
          const cleanSub = rawSources.filter((s) => !isHSub(s) && !isDub(s));
          if (cleanSub.length > 0) mainSources = cleanSub;
        } else if (prefSubDub === "hsub") {
          const cleanHsub = rawSources.filter((s) => isHSub(s));
          if (cleanHsub.length > 0) mainSources = cleanHsub;
        } else if (prefSubDub === "dub") {
          const cleanDub = rawSources.filter((s) => isDub(s));
          if (cleanDub.length > 0) mainSources = cleanDub;
        }

        const rawSubtitles =
          prefSubDub === "hsub"
            ? []
            : Array.isArray(sourcesArray.subtitles)
              ? sourcesArray.subtitles
              : [];

        const formattedSubtitles = rawSubtitles.map((s) => {
          const label = s?.lang || s?.label || s?.name || "";
          return {
            ...s,
            lang: label,
            label,
          };
        });

        sourcesArray = {
          ...sourcesArray,
          sources: mainSources,
          subtitles: formattedSubtitles,
        };
      }

      res.status(200).json(sourcesArray || { sources: [] });
    } else {
      if (!epNum) throw new Error("Episode Number Not Found");
      if (!ep) throw new Error("Anime ID Not Found");

      const config = await settingfetch();

      let videoData = {
        sources: [],
        subtitles: [],
        intro: null,
      };

      const SourcesData = await getSourceById(
        "Anime",
        config?.CustomDownloadLocation,
        ep,
        epNum,
        subdub,
      );

      if (SourcesData?.filepath) {
        videoData.sources.push({
          url: `/video?path=${encodeURIComponent(SourcesData?.filepath)}`,
          quality: "HD",
          server: "Local",
          provider: "Local",
        });
      }

      if (SourcesData?.subtitleFiles?.length > 0) {
        videoData.subtitles = SourcesData?.subtitleFiles;
      }

      if (SourcesData?.skipTimes) {
        videoData.skipTimes = SourcesData.skipTimes;
      }

      res.status(200).json(videoData);
    }
  } catch (err) {
    logger.error(`Error Fetching M3U8 Playlist`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json({
      sources: [],
    });
  }
});

// Resolve specific server stream on demand (lazy loading)
router.post("/api/watch/server", async (req, res) => {
  const { provider = null, server } = req.body;
  try {
    if (!server) throw new Error("Server payload missing");
    const Animeprovider = await providerFetch("Anime", provider);
    const resolved = await processServer(Animeprovider, server);
    if (!resolved) {
      return res.json({ error: true, message: "Failed to resolve server" });
    }
    res.status(200).json(resolved);
  } catch (err) {
    logger.error(`Error resolving server stream: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

// Play Video From Local Source
router.get("/video", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send("No file path provided");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === ".ts" ? "video/mp2t" : "video/mp4";

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).send("Requested range not satisfiable");
      return;
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });

    if (req.method === "HEAD") {
      return res.end();
    }
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });

    if (req.method === "HEAD") {
      return res.end();
    }
    fs.createReadStream(filePath).pipe(res);
  }
});

// Serve Local Subtitles
router.get("/subtitles", (req, res) => {
  try {
    let subtitlePath = req.query.file;
    if (!subtitlePath) {
      return res.status(400).json({ error: "Subtitle file path required" });
    }

    subtitlePath = decodeURIComponent(subtitlePath);

    if (!fs.existsSync(subtitlePath)) {
      return res.status(404).json({ error: "Subtitle file not found" });
    }

    const ext = path.extname(subtitlePath);
    const mimeType = ext === ".srt" ? "application/x-subrip" : "text/vtt";
    res.setHeader("Content-Type", mimeType);
    return res.sendFile(subtitlePath, { dotfiles: "allow" });
  } catch (err) {
    console.error("Error serving subtitle:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Fetch Manga Chapter
router.post("/api/read", async (req, res) => {
  const { chapterID, Downloaded = false, MangaID, provider = null } = req.body;
  try {
    if (!chapterID) throw new Error("Chapter ID is missing");

    let isLocal = Downloaded;
    let SourcesData = null;
    const config = await settingfetch();

    if (MangaID) {
      try {
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
        if (SourcesData?.filepath && fs.existsSync(SourcesData.filepath)) {
          isLocal = true;
        }
      } catch (e) {}
    }

    if (isLocal) {
      if (!SourcesData) {
        if (!MangaID) throw new Error("Manga ID is missing");
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
      }

      if (SourcesData?.filepath) {
        const zipData = fs.readFileSync(SourcesData.filepath);
        const zip = await JSZip.loadAsync(zipData);

        const pages = await Promise.all(
          Object.keys(zip.files)
            .filter((file) => file.match(/^\d+\./))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(async (file) => ({
              page: parseInt(file),
              img: `data:image/jpeg;base64,${await zip
                .file(file)
                .async("base64")}`,
            })),
        );
        res.json(pages);
      } else {
        throw new Error("Chapter Not Found In Downloads!");
      }
    } else {
      const providerObj = await providerFetch("Manga", provider);
      const chapters = await MangaChapterFetch(providerObj, chapterID);
      return res.status(200).json(chapters);
    }
  } catch (err) {
    logger.error(`Failed To Fetch Manga Chapters`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json([]);
  }
});

// Proxy for Images
router.get("/api/image", async (req, res) => {
  let decodedUrl = "";
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Missing image url");
    }

    decodedUrl = decodeURIComponent(imageUrl);

    if (decodedUrl.startsWith("file://") || decodedUrl.startsWith("/")) {
      const filePath = decodedUrl.startsWith("file://")
        ? decodedUrl.slice(7)
        : decodedUrl;
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(filePath, { dotfiles: "allow" });
      } else {
        return res.status(404).send("Local file not found");
      }
    }

    try {
      const cached = queryOne("SELECT filename FROM ImageCache WHERE url = ?", [
        decodedUrl,
      ]);
      const cacheDir = ImageCacheManager.getImageCacheDir();
      if (
        cached &&
        cached.filename &&
        fs.existsSync(path.join(cacheDir, cached.filename))
      ) {
        run("UPDATE ImageCache SET last_accessed = ? WHERE url = ?", [
          Date.now(),
          decodedUrl,
        ]);

        let contentType = "image/jpeg";
        if (cached.filename.endsWith(".png")) contentType = "image/png";
        else if (cached.filename.endsWith(".gif")) contentType = "image/gif";
        else if (cached.filename.endsWith(".webp")) contentType = "image/webp";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(path.join(cacheDir, cached.filename), {
          dotfiles: "allow",
        });
      }
    } catch (cacheErr) {
      logger.error("Error reading from image cache: " + cacheErr.message);
    }

    let imageBuffer = null;
    let contentType = "image/jpeg";

    try {
      const resolvedHeaders = getHeaders(decodedUrl);
      const options = {
        responseType: "arraybuffer",
        skipBypass: true,
        headers: {
          Accept:
            resolvedHeaders.Accept ||
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          ...(resolvedHeaders.Referer
            ? { Referer: resolvedHeaders.Referer }
            : {}),
          ...(resolvedHeaders["User-Agent"]
            ? { "User-Agent": resolvedHeaders["User-Agent"] }
            : {}),
          ...(resolvedHeaders.Cookie ? { Cookie: resolvedHeaders.Cookie } : {}),
        },
      };
      const response = await global.axios.get(decodedUrl, options);
      imageBuffer = Buffer.isBuffer(response.data)
        ? response.data
        : Buffer.from(response.data);
      contentType = response.headers["content-type"] || "image/jpeg";
    } catch (err) {
      if (!imageBuffer && global.scrapperFetchDataUrl) {
        try {
          const dataUrl = await global.scrapperFetchDataUrl(decodedUrl);
          if (dataUrl && dataUrl.startsWith("data:")) {
            const matches = dataUrl.match(
              /^data:(image\/[a-zA-Z0-9+-]+);base64,(.+)$/,
            );
            if (matches) {
              contentType = matches[1];
              imageBuffer = Buffer.from(matches[2], "base64");
            }
          }
        } catch (scrapperErr) {
          console.error(
            "scrapperFetchDataUrl failed for image:",
            scrapperErr.message,
          );
        }
      }
    }

    if (imageBuffer) {
      try {
        ImageCacheManager.cacheImage(decodedUrl, imageBuffer).catch(() => {});
      } catch (_) {}

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(imageBuffer);
    }
    res.status(500).send("Failed to load image");
  } catch (err) {
    console.error("Image proxy fetch failed:", err.message);
    res.status(500).send("Failed to load image");
  }
});

// Proxy for m3u8 playlist
router.get("/api/stream/m3u8", async (req, res) => {
  const url = req.query.url;
  const customReferer = req.query.referer;
  if (!url) return res.status(400).send("No URL");
  try {
    if (customReferer && global.setDynamicReferer) {
      global.setDynamicReferer(url, customReferer);
    }
    const port = global.PORT || 3000;
    const reqHeaders = getHeaders(url);
    if (customReferer) {
      reqHeaders.Referer = customReferer;
    }
    let data;
    try {
      const resp = await global.axios.get(url, {
        headers: reqHeaders,
        responseType: "text",
        timeout: 15000,
      });
      data = resp.data;
    } catch (fetchErr) {
      if (
        fetchErr.response &&
        (fetchErr.response.status === 403 ||
          fetchErr.response.status === 503) &&
        global.cloudflarebypass
      ) {
        const bypassTarget =
          url.includes("owocdn") ||
          url.includes("uwucdn") ||
          url.includes("kwik")
            ? customReferer || "https://kwik.cx/"
            : customReferer || url;
        await global.cloudflarebypass(bypassTarget, true);
        const freshHeaders = getHeaders(url);
        if (customReferer) freshHeaders.Referer = customReferer;
        const retry = await global.axios.get(url, {
          headers: freshHeaders,
          responseType: "text",
          timeout: 15000,
        });
        data = retry.data;
      } else {
        throw fetchErr;
      }
    }
    if (typeof data !== "string" || !data.includes("#EXTM3U")) {
      logger.warn(
        `[Stream Proxy] Upstream returned invalid m3u8 playlist for ${url}`,
      );
      return res
        .status(502)
        .send("Upstream returned invalid playlist manifest");
    }
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    const refParam = customReferer
      ? `&referer=${encodeURIComponent(customReferer)}`
      : "";
    const segProxy = `http://127.0.0.1:${port}/api/stream/segment?url=`;
    const m3u8Proxy = `http://127.0.0.1:${port}/api/stream/m3u8?url=`;

    const regHost = (targetAbs) => {
      if (
        customReferer &&
        global.setDynamicReferer &&
        targetAbs.startsWith("http")
      ) {
        try {
          global.setDynamicReferer(new URL(targetAbs).hostname, customReferer);
        } catch (_) {}
      }
    };

    let nextIsVariantPlaylist = false;
    const manifest = String(data)
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
          if (t.startsWith("#EXT-X-STREAM-INF:")) {
            nextIsVariantPlaylist = true;
          }
          return t.includes('URI="')
            ? t.replace(/URI="([^"]+)"/, (_, u) => {
                const abs = u.startsWith("http") ? u : base + u;
                regHost(abs);
                const isSubOrAudio =
                  t.includes("TYPE=SUBTITLES") || t.includes("TYPE=AUDIO");
                const proxy =
                  abs.includes(".m3u8") || isSubOrAudio ? m3u8Proxy : segProxy;
                return `URI="${proxy}${encodeURIComponent(abs)}${refParam}"`;
              })
            : line;
        }

        const isVariant = nextIsVariantPlaylist;
        nextIsVariantPlaylist = false;

        const abs = t.startsWith("http") ? t : base + t;
        regHost(abs);
        const proxy = isVariant || abs.includes(".m3u8") ? m3u8Proxy : segProxy;
        return `${proxy}${encodeURIComponent(abs)}${refParam}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(manifest);
  } catch (err) {
    logger.error(`[StreamProxy] m3u8 error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

// Proxy for m3u8 video segment
router.get("/api/stream/segment", async (req, res) => {
  const url = req.query.url;
  const customReferer = req.query.referer;
  if (!url) return res.status(400).send("No URL");
  try {
    if (customReferer && global.setDynamicReferer) {
      global.setDynamicReferer(url, customReferer);
    }
    const reqHeaders = getHeaders(url);
    if (customReferer) {
      reqHeaders.Referer = customReferer;
    }
    let attempts = 0;
    let data, headers;
    while (attempts < 2) {
      try {
        const resp = await global.axios.get(url, {
          headers: reqHeaders,
          responseType: "arraybuffer",
          timeout: 10000,
        });
        data = resp.data;
        headers = resp.headers;
        break;
      } catch (err) {
        attempts++;
        const status = err.response?.status;
        if (status === 429 && attempts < 2) {
          await new Promise((r) => setTimeout(r, 1000));
        } else if (
          (status === 403 || status === 503) &&
          attempts < 2 &&
          global.cloudflarebypass
        ) {
          try {
            const bypassTarget =
              url.includes("owocdn") ||
              url.includes("uwucdn") ||
              url.includes("kwik")
                ? customReferer || "https://kwik.cx/"
                : customReferer || url;
            await global.cloudflarebypass(bypassTarget, true);
            const fresh = getHeaders(url);
            if (customReferer) fresh.Referer = customReferer;
            Object.assign(reqHeaders, fresh);
          } catch (_) {}
        } else if (attempts >= 2) {
          throw err;
        }
      }
    }

    if (
      !Buffer.isBuffer(data) &&
      !(data instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(data) &&
      typeof data !== "string"
    ) {
      throw new Error("Invalid binary/stream payload from upstream");
    }
    let buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      for (let i = 0; i < Math.min(buffer.length - 3, 1024); i++) {
        if (
          buffer[i] === 0x49 &&
          buffer[i + 1] === 0x45 &&
          buffer[i + 2] === 0x4e &&
          buffer[i + 3] === 0x44
        ) {
          buffer = buffer.subarray(i + 8);
          break;
        }
      }
    }

    const ct = headers?.["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", ct.includes("image") ? "video/mp2t" : ct);
    res.send(buffer);
  } catch (err) {
    logger.error(`[StreamProxy] segment error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

async function linkMediaItem({ oldId, malId, type, title, image }) {
  const itemType = type || "Anime";
  const malIdStr = malId ? String(malId) : null;

  if (!malIdStr && !oldId) {
    throw new Error("Missing malId or oldId");
  }

  const numMalId = Number(malIdStr);
  let selectedProvider = null;
  let resolvedProviderId = null;

  if (global.mappingDb && numMalId) {
    try {
      const best = await getBestProviderForMalId(numMalId, itemType);
      if (best) {
        selectedProvider = best.provider;
        resolvedProviderId = best.id;
      }
    } catch (err) {
      logger.error(`Error querying mappingDb for link-mapping: ${err.message}`);
    }
  }
  if (!selectedProvider) {
    selectedProvider = itemType === "Anime" ? "pahe" : "weebcentral";
  }

  const finalId = resolvedProviderId || oldId || malIdStr;

  if (numMalId) {
    if (!title) {
      try {
        const titleRes = await fetch(
          `https://strawverse.theyogmehta.online/api/title/${itemType}/${numMalId}`,
        );
        if (titleRes.ok) {
          const tData = await titleRes.json();
          if (tData && tData.title) {
            title = tData.title;
          }
        }
      } catch (_) {}
    }

    if (!image && global.mappingDb) {
      try {
        const imgRow = await global.mappingDb
          .prepare(
            itemType === "Anime"
              ? "SELECT image_url FROM anime WHERE malid = ?"
              : "SELECT image_url FROM manga WHERE malid = ?",
          )
          .get(numMalId);
        if (imgRow && imgRow.image_url) {
          image = imgRow.image_url;
        }
      } catch (_) {}
    }
  }

  const cleanFolder = sanitizeFolderName(title || oldId || finalId);

  if (global.db) {
    try {
      const stmt = global.db.prepare(
        "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, ?)",
      );
      if (oldId) await stmt.run(oldId, String(numMalId));
      if (finalId) await stmt.run(finalId, String(numMalId));
      if (cleanFolder) await stmt.run(cleanFolder, String(numMalId));

      const existing = await queryOne(
        `SELECT * FROM ${itemType} WHERE id = ? OR id = ? OR folder_name = ?`,
        [finalId, oldId, cleanFolder],
      );

      if (existing) {
        await run(
          `UPDATE ${itemType} SET id = ?, MalID = ?, provider = ?, title = COALESCE(NULLIF(?, ''), title), image_url = COALESCE(NULLIF(?, ''), image_url), folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id = ? OR folder_name = ?`,
          [
            finalId,
            String(numMalId),
            selectedProvider,
            title || existing.title || "",
            image || existing.image_url || "",
            cleanFolder,
            oldId || finalId,
            finalId,
            cleanFolder,
          ],
        );
      } else {
        await run(
          `INSERT OR REPLACE INTO ${itemType} (id, title, image_url, folder_name, MalID, provider, CustomTag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            finalId,
            title || finalId,
            image || "",
            cleanFolder,
            String(numMalId),
            selectedProvider,
            JSON.stringify(["downloads"]),
          ],
        );
      }
    } catch (err) {
      logger.error(`Error updating local db in link-mapping: ${err.message}`);
    }
  }

  if (oldId && oldId !== finalId && global.db) {
    try {
      if (itemType === "Anime") {
        await run("UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?", [
          finalId,
          oldId,
        ]);
        await run("UPDATE SkipTimes SET anime_id = ? WHERE anime_id = ?", [
          finalId,
          oldId,
        ]);
      } else {
        await run("UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?", [
          finalId,
          oldId,
        ]);
      }
    } catch (_) {}
  }

  const linkedProviders = await getLinkedProvidersForMalId(numMalId, itemType, {
    currentProvider: selectedProvider,
    currentId: finalId,
    title: title || "",
    installedOnly: true,
  });

  const details = {
    id: finalId,
    dataId: oldId,
    malid: numMalId,
    title: title || finalId,
    image: image || "",
    image_url: image || "",
    provider: selectedProvider,
    linkedProviders,
    CustomTag: JSON.stringify(["downloads"]),
  };

  return {
    success: true,
    newId: finalId,
    provider: selectedProvider,
    details,
  };
}

// Handles linking local downloaded entries to provider mappings
router.post(
  ["/api/local/link-mapping", "/api/mapping/link-item"],
  async (req, res) => {
    try {
      const result = await linkMediaItem(req.body);
      return res.json(result);
    } catch (err) {
      logger.error(`Failed to link item: ${err.message}`);
      const isClientError = err.message && err.message.startsWith("Missing");
      return res.status(isClientError ? 400 : 500).json({ error: err.message });
    }
  },
);

module.exports = router;
