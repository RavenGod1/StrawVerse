// libs
const Module = require("module");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");

// Functions
const {
  getDownloadsFolder,
  ensureDirectoryExists,
} = require("./DirectoryMaker");
const { logger, configureExternalLogs } = require("./AppLogger.js");

// Log folder users can actually reach: shared StrawVerse/logs on
// mobile, ~/StrawVerse/logs on desktop.
function getEffectiveLogDir() {
  if (
    process.env.NODEJS_MOBILE_DATA_DIR &&
    process.env.STRAWVERSE_PUBLIC_ROOT
  ) {
    try {
      const dir = path.join(process.env.STRAWVERSE_PUBLIC_ROOT, "logs");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (_) {}
  }
  const { getExternalLogDir } = require("./AppLogger.js");
  return getExternalLogDir();
}
const { setKeyValue, queryAll, unwrapJson } = require("./db");
const { getUserDataPath, isAndroid } = require("./constants");

const userDataPath = getUserDataPath();

let StartDiscordRPC = null;
let StopDiscordRPC = null;
if (process.versions?.electron && !isAndroid) {
  try {
    const discord = require("./discord");
    StartDiscordRPC = discord.StartDiscordRPC;
    StopDiscordRPC = discord.StopDiscordRPC;
  } catch (e) {}
}

const appNodeModules = path.join(__dirname, "..", "..", "node_modules");

let config = {},
  ScraperAnime,
  ScraperManga,
  ScraperIcons;
global.Anime_providers = {};
global.Manga_providers = {};

async function reconcileActiveProvider(Type) {
  const isAnime = Type === "Anime";
  const settingKey = isAnime ? "Animeprovider" : "Mangaprovider";
  const providers = isAnime
    ? global.Anime_providers || {}
    : global.Manga_providers || {};
  const currentProvider = config?.[settingKey] || null;
  const nextProvider = Object.prototype.hasOwnProperty.call(
    providers,
    currentProvider,
  )
    ? currentProvider
    : Object.keys(providers)[0] || null;

  if (config?.[settingKey] !== nextProvider) {
    config[settingKey] = nextProvider;
    await settingSave();
  }

  return nextProvider;
}

// update the settings
async function settingupdate(newSettings = {}) {
  if (newSettings && typeof newSettings === "object") {
    if (process.env.NODEJS_MOBILE_DATA_DIR) {
      delete newSettings.CustomDownloadLocation;
    }
    for (const [k, v] of Object.entries(newSettings)) {
      if (v !== undefined) {
        config[k] = v;
      }
    }
  }

  if (process.env.NODEJS_MOBILE_DATA_DIR) {
    config.CustomDownloadLocation = getDownloadsFolder();
  }

  if (process.versions?.electron && StartDiscordRPC) {
    if (config.enableDiscordRPC === true) {
      try {
        await StartDiscordRPC();
        logger.info("Discord RPC Activated");
      } catch (err) {
        logger.error(
          `Failed to activate Discord RPC (will retry when watching): ${err.message}`,
        );
      }
    } else if (StopDiscordRPC) {
      let stopped = await StopDiscordRPC();
      if (stopped) logger.info("Discord RPC DISABLED");
    }
  }

  try {
    configureExternalLogs({
      enabled: config.externalLogEnabled !== false,
      maxFiles: config.maxLogFiles,
      dir: getEffectiveLogDir(),
    });
  } catch (_) {}

  await settingSave();
  return config;
}

// returns valid settings
async function settingfetch() {
  try {
    let changes = false;
    if (typeof config?.CustomDownloadLocation === "string") {
      config.CustomDownloadLocation = config.CustomDownloadLocation.replace(
        /^["']|["']$/g,
        "",
      ).trim();
    }
    // making sure download folder exists
    if (!config?.CustomDownloadLocation) {
      config.CustomDownloadLocation = getDownloadsFolder();
      changes = true;
    }

    // if downloads folder exists check if its can be access
    if (config?.CustomDownloadLocation) {
      try {
        await ensureDirectoryExists(config?.CustomDownloadLocation);
      } catch (error) {
        console.log(error);
        config.CustomDownloadLocation = getDownloadsFolder();
        changes = true;
      }
    }
    // kept log files: default 5, user range 1..10
    const parsedLogFiles = parseInt(config?.maxLogFiles, 10);
    const clampedLogFiles = isNaN(parsedLogFiles)
      ? 5
      : Math.min(Math.max(parsedLogFiles, 1), 10);
    if (config?.maxLogFiles !== clampedLogFiles) {
      config.maxLogFiles = clampedLogFiles;
      changes = true;
    }
    // checking Animeprovider is valid
    if (
      global.scrapersLoaded &&
      (!config?.Animeprovider ||
        !global?.Anime_providers[config?.Animeprovider])
    ) {
      const availableAnimeProviders = Object.keys(global.Anime_providers);
      if (availableAnimeProviders.length > 0) {
        config.Animeprovider = availableAnimeProviders[0];
        changes = true;
      }
    }

    // checking Mangaprovider is valid
    if (
      global.scrapersLoaded &&
      (!config?.Mangaprovider ||
        !global?.Manga_providers[config?.Mangaprovider])
    ) {
      const availableMangaProviders = Object.keys(global.Manga_providers);
      if (availableMangaProviders.length > 0) {
        config.Mangaprovider = availableMangaProviders[0];
        changes = true;
      }
    }

    if (!config?.hasOwnProperty("autoPlayNextEpisode")) {
      config.autoPlayNextEpisode = true;
      changes = true;
    }

    if (!config?.hasOwnProperty("autoSkipIntro")) {
      config.autoSkipIntro = true;
      changes = true;
    }

    if (!config?.hasOwnProperty("enableDiscordRPC")) {
      config.enableDiscordRPC = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("malDiscordProfile")) {
      config.malDiscordProfile = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("imageCacheSizeLimit")) {
      config.imageCacheSizeLimit = 5;
      changes = true;
    }

    if (!config?.hasOwnProperty("developerMode")) {
      config.developerMode = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("upscalePreset")) {
      config.upscalePreset = "off";
      changes = true;
    }

    if (!config?.hasOwnProperty("forceHighPerformanceGpu")) {
      config.forceHighPerformanceGpu = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("preferredSubtitleLanguages")) {
      config.preferredSubtitleLanguages = ["English"];
      changes = true;
    }

    if (!config?.hasOwnProperty("subFontSize")) {
      config.subFontSize = 46;
      changes = true;
    }

    if (!config?.hasOwnProperty("subColor")) {
      config.subColor = "#FFFFFF";
      changes = true;
    }

    if (!config?.hasOwnProperty("subBorderColor")) {
      config.subBorderColor = "#000000";
      changes = true;
    }

    if (!config?.hasOwnProperty("subBorderSize")) {
      config.subBorderSize = 3.0;
      changes = true;
    }

    if (!config?.hasOwnProperty("subBgColor")) {
      config.subBgColor = "transparent";
      changes = true;
    }

    if (!config?.hasOwnProperty("playerSpeed")) {
      config.playerSpeed = 1.0;
      changes = true;
    }

    if (changes) {
      await settingSave();
    }

    return config;
  } catch (err) {
    logger.error("Failed To Update Settings");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// load settings
async function SettingsLoad() {
  try {
    let storedConfig = null;
    try {
      const rows = await queryAll("SELECT key, value FROM Settings");
      if (rows && rows.length > 0) {
        storedConfig = {};
        for (const row of rows) {
          storedConfig[row.key] = unwrapJson(row.value);
        }
      }
    } catch (_) {}
    config =
      storedConfig && typeof storedConfig === "object"
        ? storedConfig
        : {
            quality: "1080p",
            mal_on_off: false,
            status: "watching",
            malToken: null,
            CustomDownloadLocation: getDownloadsFolder(),
            externalLogEnabled: true,
            maxLogFiles: 5,
            Animeprovider: 0,
            Mangaprovider: 0,
            autoLoadNextChapter: true,
            Pagination: false,
            enableDiscordRPC: false,
            mergeSubtitles: false,
            subtitleFormat: "vtt",
            malDiscordProfile: false,
            imageCacheSizeLimit: 5,
            developerMode: false,
            autoSkipIntro: true,
            autoPlayNextEpisode: true,
            subFontSize: 46,
            subColor: "#FFFFFF",
            subBorderColor: "#000000",
            subBorderSize: 3.0,
            subBgColor: "transparent",
            playerSpeed: 1.0,
            infoSortOrder: null,
            upscalePreset: "off",
            forceHighPerformanceGpu: false,
            preferredSubtitleLanguages: ["English"],
          };

    if (config && !config.hasOwnProperty("subFontSize")) {
      config.subFontSize = 46;
    }
    if (config && !config.hasOwnProperty("subColor")) {
      config.subColor = "#FFFFFF";
    }
    if (config && !config.hasOwnProperty("subBorderColor")) {
      config.subBorderColor = "#000000";
    }
    if (config && !config.hasOwnProperty("subBorderSize")) {
      config.subBorderSize = 3.0;
    }
    if (config && !config.hasOwnProperty("subBgColor")) {
      config.subBgColor = "transparent";
    }
    if (config && !config.hasOwnProperty("playerSpeed")) {
      config.playerSpeed = 1.0;
    }

    if (config && !config.hasOwnProperty("imageCacheSizeLimit")) {
      config.imageCacheSizeLimit = 5;
    }

    if (config && !config.hasOwnProperty("externalLogEnabled")) {
      config.externalLogEnabled = true;
    }
    // One-time migration: external logs were force-disabled on mobile
    // before this setting existed there, so flip it on exactly once.
    if (config && !config.hasOwnProperty("maxLogFiles")) {
      config.maxLogFiles = 5;
    }
    if (
      process.env.NODEJS_MOBILE_DATA_DIR &&
      !config.hasOwnProperty("logPolicyMigrated")
    ) {
      config.externalLogEnabled = true;
      config.logPolicyMigrated = true;
    }

    if (config && !config.hasOwnProperty("developerMode")) {
      config.developerMode = false;
    }

    if (config && !config.hasOwnProperty("upscalePreset")) {
      config.upscalePreset = "off";
    }

    if (config && !config.hasOwnProperty("forceHighPerformanceGpu")) {
      config.forceHighPerformanceGpu = false;
    }

    if (config && !config.hasOwnProperty("preferredSubtitleLanguages")) {
      config.preferredSubtitleLanguages = ["English"];
    }

    let currentVersion = "1.0.0";
    try {
      const { app } = require("electron");
      if (app && typeof app.getVersion === "function") {
        currentVersion = app.getVersion();
      }
    } catch (e) {}
    if (!currentVersion || currentVersion === "1.0.0") {
      try {
        const pkg = require("../../package.json");
        currentVersion = pkg.version || "1.0.0";
      } catch (e) {}
    }

    if (!config.lastVersion || config.lastVersion !== currentVersion) {
      config.showWhatsNew = true;
      config.lastVersion = currentVersion;
    }

    if (config.malToken != null) {
      try {
        const { MalRefreshTokenGen } = require("./mal");
        if (typeof MalRefreshTokenGen === "function") {
          let Tosave = await MalRefreshTokenGen(config.malToken);
          if (Tosave) await settingupdate(Tosave);
        }
      } catch (malErr) {
        logger.error(
          "Failed to refresh MAL token on settings load: " + malErr.message,
        );
      }
    }

    if (
      process.versions?.electron &&
      StartDiscordRPC &&
      config?.enableDiscordRPC === true
    ) {
      try {
        await StartDiscordRPC();
        logger.info("Discord RPC Activated");
      } catch (err) {
        logger.error(err);
      }
    }
  try {
    configureExternalLogs({
      enabled: config.externalLogEnabled !== false,
      maxFiles: config.maxLogFiles,
      dir: getEffectiveLogDir(),
    });
  } catch (_) {}

    await settingSave();
  } catch (err) {
    logger.error("Failed To Load Config");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// save the settings
async function settingSave() {
  try {
    for (const [k, v] of Object.entries(config)) {
      await setKeyValue("Settings", k, v);
    }
  } catch (err) {
    logger.error("Failed To Save Config");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

function disableWhatsNew() {
  try {
    config.showWhatsNew = false;
    settingSave();
  } catch (err) {
    logger.error("Failed To Disable What's New");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

function ensureNomediaFile(dir) {
  try {
    const nomedia = path.join(dir, ".nomedia");
    if (!fs.existsSync(nomedia)) {
      fs.writeFileSync(nomedia, "");
    }
  } catch (_) {}
}

// Check Folder Exists
async function CheckScrapperFolderExists() {
  const scraperBaseName = process.env.NODEJS_MOBILE_DATA_DIR
    ? "scrapper"
    : "scrapers";
  const iconBaseName = process.env.NODEJS_MOBILE_DATA_DIR ? "ico" : "icons";

  const Scraper = path.join(userDataPath, scraperBaseName);
  if (!fs.existsSync(Scraper)) {
    fs.mkdirSync(Scraper, { recursive: true });
    logger.info(`Created scraper folder: ${Scraper}`);
  }
  ensureNomediaFile(Scraper);

  ScraperAnime = path.join(Scraper, "Anime");
  if (!fs.existsSync(ScraperAnime)) {
    fs.mkdirSync(ScraperAnime, { recursive: true });
    logger.info(`Created Anime scraper folder: ${ScraperAnime}`);
  }

  ScraperManga = path.join(Scraper, "Manga");
  if (!fs.existsSync(ScraperManga)) {
    fs.mkdirSync(ScraperManga, { recursive: true });
    logger.info(`Created Manga scraper folder: ${ScraperManga}`);
  }

  ScraperIcons = path.join(Scraper, iconBaseName);
  if (!fs.existsSync(ScraperIcons)) {
    fs.mkdirSync(ScraperIcons, { recursive: true });
    logger.info(`Created icons folder: ${ScraperIcons}`);
  }
  ensureNomediaFile(ScraperIcons);
}

// Patch Module Path
async function patchModulePaths() {
  await CheckScrapperFolderExists();
  try {
    // Statically mark cheerio as used for extensions/scrapers
    require("cheerio");
  } catch (_) {}
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain) {
    try {
      return originalResolve.call(this, request, parent, isMain);
    } catch (err) {
      const isScraper =
        parent &&
        parent.filename &&
        (parent.filename.startsWith(ScraperAnime) ||
          parent.filename.startsWith(ScraperManga));

      if (isScraper) {
        try {
          const customPath = path.join(appNodeModules, request);
          return originalResolve.call(this, customPath, parent, isMain);
        } catch (innerErr) {}
      }
      throw err;
    }
  };
}

// load scrapers
async function loadAllScrapers() {
  try {
    await CheckScrapperFolderExists();

    // Development only extension sync for Electron
    if (process.versions?.electron) {
      try {
        const { app } = require("electron");
        if (app && typeof app.getAppPath === "function") {
          const localExtDir = path.join(
            app.getAppPath(),
            "..",
            "extensions",
            "extensions",
          );
          if (fs.existsSync(localExtDir)) {
            const repoAnime = path.join(localExtDir, "Anime");
            if (fs.existsSync(repoAnime)) {
              const files = fs
                .readdirSync(repoAnime)
                .filter((f) => f.endsWith(".js"));
              for (const f of files) {
                fs.copyFileSync(
                  path.join(repoAnime, f),
                  path.join(ScraperAnime, f),
                );
              }
            }
            const repoManga = path.join(localExtDir, "Manga");
            if (fs.existsSync(repoManga)) {
              const files = fs
                .readdirSync(repoManga)
                .filter((f) => f.endsWith(".js"));
              for (const f of files) {
                fs.copyFileSync(
                  path.join(repoManga, f),
                  path.join(ScraperManga, f),
                );
              }
            }
          }
        }
      } catch (e) {}
    }

    logger.info("Loading all scrapers...");

    global.Anime_providers = {};
    global.Manga_providers = {};

    let animeCount = 0;
    let mangaCount = 0;

    const animeFiles = fs.readdirSync(ScraperAnime);
    for (const file of animeFiles) {
      if (file.endsWith(".js")) {
        const fullPath = path.join(ScraperAnime, file);
        try {
          delete require.cache[require.resolve(fullPath)];
          const scraper = require(fullPath);
          if (scraper?.name) {
            global.Anime_providers[scraper.name] = scraper;
            animeCount++;
            logger.info(`Loaded anime scraper: ${scraper.name}`);
          } else {
            logger.warn(`Scraper missing 'name' export: ${file}`);
          }
        } catch (err) {
          logger.error(`Failed to load anime scraper ${file}: ${err.message}`);
        }
      }
    }

    const mangaFiles = fs.readdirSync(ScraperManga);
    for (const file of mangaFiles) {
      if (file.endsWith(".js")) {
        const fullPath = path.join(ScraperManga, file);
        try {
          delete require.cache[require.resolve(fullPath)];
          const scraper = require(fullPath);
          if (scraper?.name) {
            global.Manga_providers[scraper.name] = scraper;
            mangaCount++;
            logger.info(`Loaded manga scraper: ${scraper.name}`);
          } else {
            logger.warn(`Scraper missing 'name' export: ${file}`);
          }
        } catch (err) {
          logger.error(`Failed to load manga scraper ${file}: ${err.message}`);
        }
      }
    }

    global.scrapersLoaded = true;
    notifyScrapersUpdated();
    await reconcileActiveProvider("Anime");
    await reconcileActiveProvider("Manga");

    logger.info(
      `All scrapers loaded. Total Anime: ${animeCount}, Manga: ${mangaCount}`,
    );
  } catch (err) {
    logger.error(`Failed to load scrapers: ${err.message}`);
  }
}

function notifyScrapersUpdated() {
  try {
    if (global.sendToRenderer) {
      const cleanAnime = Object.keys(global.Anime_providers || {});
      const cleanManga = Object.keys(global.Manga_providers || {});
      global.sendToRenderer("scrapers-updated", {
        anime: cleanAnime,
        manga: cleanManga,
      });
    }
  } catch (err) {
    logger.error("Failed to notify scrapers update: " + err.message);
  }
}

async function loadSingleScraper(AnimeManga, ExtensionName) {
  try {
    await CheckScrapperFolderExists();
    const folder = AnimeManga === "Anime" ? ScraperAnime : ScraperManga;
    const fullPath = path.join(folder, `${ExtensionName}.js`);

    if (!fs.existsSync(fullPath)) {
      logger.error(`Scraper file not found: ${fullPath}`);
      return;
    }

    try {
      delete require.cache[require.resolve(fullPath)];
    } catch (_) {}

    const scraper = require(fullPath);
    if (scraper?.name) {
      if (AnimeManga === "Anime") {
        global.Anime_providers[scraper.name] = scraper;
      } else {
        global.Manga_providers[scraper.name] = scraper;
      }
      logger.info(
        `Loaded/Reloaded ${AnimeManga.toLowerCase()} scraper: ${scraper.name}`,
      );
      notifyScrapersUpdated();
      await reconcileActiveProvider(AnimeManga);
    } else {
      logger.warn(`Scraper missing 'name' export: ${fullPath}`);
    }
  } catch (err) {
    logger.error(
      `Failed to load/reload scraper ${ExtensionName}: ${err.message}`,
    );
  }
}

async function unloadSingleScraper(AnimeManga, ExtensionName) {
  try {
    if (AnimeManga === "Anime") {
      delete global.Anime_providers[ExtensionName];
    } else {
      delete global.Manga_providers[ExtensionName];
    }
    logger.info(
      `Unloaded ${AnimeManga.toLowerCase()} scraper: ${ExtensionName}`,
    );
    await reconcileActiveProvider(AnimeManga);
    notifyScrapersUpdated();
  } catch (err) {
    logger.error(`Failed to unload scraper ${ExtensionName}: ${err.message}`);
  }
}

// Download / Delete Scrapper
async function HandleExtensions(TaskType, AnimeManga, ExtensionName) {
  await CheckScrapperFolderExists();
  const extensionPath = path.join(
    AnimeManga === "Anime" ? ScraperAnime : ScraperManga,
    `${ExtensionName}.js`,
  );
  if (TaskType === "add") {
    try {
      const response = await got(
        `https://raw.githubusercontent.com/RavenGod1/extensions/refs/heads/main/extensions/${AnimeManga}/${ExtensionName}.js`,
      ).text();

      if (response.includes("404: Not Found")) {
        return {
          type: "error",
          title: "Scrapper Not Found",
          message: "Check Your Connection & Try Again",
        };
      }

      await fs.promises.writeFile(extensionPath, response);

      try {
        const iconUrl = `https://raw.githubusercontent.com/RavenGod1/extensions/refs/heads/main/ico/${ExtensionName}.ico`;
        const iconDest = path.join(ScraperIcons, `${ExtensionName}.ico`);
        const iconBuffer = await got(iconUrl, {
          responseType: "buffer",
        }).buffer();
        if (iconBuffer && iconBuffer.length > 0) {
          await fs.promises.writeFile(iconDest, iconBuffer);
        }
      } catch (iconErr) {}

      await loadSingleScraper(AnimeManga, ExtensionName);
      return {
        type: "success",
        title: `Added ${AnimeManga} Extention!`,
        message: `${ExtensionName} is Added SuccessFully`,
      };
    } catch (err) {
      logger.error(`Failed to add scraper ${ExtensionName}: ${err.message}`);
      return {
        type: "error",
        title: `Failed to Add ${AnimeManga} Extention!`,
        message: err.message,
      };
    }
  } else if (TaskType === "remove" || TaskType === "delete") {
    try {
      if (!fs.existsSync(extensionPath)) {
        return {
          type: "error",
          title: "Scraper Not Found",
          message: `${ExtensionName} is not installed`,
        };
      }
      fs.unlinkSync(extensionPath);

      await unloadSingleScraper(AnimeManga, ExtensionName);
      return {
        type: "success",
        title: `Removed ${AnimeManga} Extention!`,
        message: `${ExtensionName} is Removed SuccessFully`,
      };
    } catch (err) {
      logger.error(`Failed to remove scraper ${ExtensionName}: ${err.message}`);
      return {
        type: "error",
        title: `Failed to Remove ${AnimeManga} Extention!`,
        message: err.message,
      };
    }
  }
  return {
    type: "error",
    title: "Unknown scraper task",
    message: `Unsupported task type: ${TaskType}`,
  };
}

// return provider
async function providerFetch(type, index) {
  try {
    let providerName;
    if (type === "Anime") {
      const providers = Object.keys(global.Anime_providers);
      if (providers.length === 0) {
        throw new Error(
          "No Anime scraper available. Please download one from marketplace.",
        );
      }
      if (
        index !== null &&
        index !== undefined &&
        global.Anime_providers[index]
      ) {
        providerName = index;
      } else {
        providerName =
          config.Animeprovider && global.Anime_providers[config.Animeprovider]
            ? config.Animeprovider
            : providers[0];
      }
      return {
        provider: global.Anime_providers[providerName],
        provider_name: providerName,
      };
    } else if (type === "Manga") {
      const providers = Object.keys(global.Manga_providers);
      if (providers.length === 0) {
        throw new Error(
          "No Manga scraper available. Please download one from marketplace.",
        );
      }
      if (
        index !== null &&
        index !== undefined &&
        global.Manga_providers[index]
      ) {
        providerName = index;
      } else {
        providerName =
          config.Mangaprovider && global.Manga_providers[config.Mangaprovider]
            ? config.Mangaprovider
            : providers[0];
      }
      return {
        provider: global.Manga_providers[providerName],
        provider_name: providerName,
      };
    }
  } catch (err) {
    logger.error("Failed To Return Provider: " + err.message);
    throw err;
  }
}

function isLanguagePreferred(subLang, preferredLanguages) {
  if (!subLang) return false;
  if (!Array.isArray(preferredLanguages)) return true;
  if (preferredLanguages.length === 0) return false;
  const sLower = subLang.toLowerCase().trim();
  const tokens = sLower.split(/[\s\-_,()[\]]+/).filter(Boolean);

  return preferredLanguages.some((pref) => {
    const pLower = (pref || "").toLowerCase().trim();
    if (!pLower) return false;
    if (sLower === pLower || sLower.includes(pLower)) return true;

    const targetCodes = [];
    if (pLower === "english") targetCodes.push("en", "eng");
    else if (pLower === "spanish") targetCodes.push("es", "spa");
    else if (pLower === "french") targetCodes.push("fr", "fre", "fra");
    else if (pLower === "german") targetCodes.push("de", "ger", "deu");
    else if (pLower === "italian") targetCodes.push("it", "ita");
    else if (pLower === "portuguese") targetCodes.push("pt", "por");
    else if (pLower === "russian") targetCodes.push("ru", "rus");
    else if (pLower === "japanese") targetCodes.push("ja", "jpn");
    else if (pLower === "chinese") targetCodes.push("zh", "chi", "zho");
    else if (pLower === "arabic") targetCodes.push("ar", "ara");
    else if (pLower === "hindi") targetCodes.push("hi", "hin");
    else targetCodes.push(pLower.slice(0, 2), pLower.slice(0, 3));

    return (
      tokens.some((t) => targetCodes.includes(t)) ||
      targetCodes.some(
        (code) =>
          sLower === code ||
          sLower.startsWith(`${code}_`) ||
          sLower.startsWith(`${code}-`),
      )
    );
  });
}

module.exports = {
  settingupdate,
  settingfetch,
  settingSave,
  SettingsLoad,
  providerFetch,
  loadAllScrapers,
  HandleExtensions,
  patchModulePaths,
  disableWhatsNew,
  isLanguagePreferred,
  getEffectiveLogDir,
  getScraperIconsPath: () => ScraperIcons,
};
