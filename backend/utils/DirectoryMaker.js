// libs
const path = require("path");
const fs = require("fs");
const os = require("os");
const { queryOne, run } = require("./db");
const { sanitizeFolderName } = require("./constants");

async function getOrCreateMediaDir(
  parentDir,
  title,
  mediaId,
  mediaType = "Anime",
  create = false,
) {
  let existingFolderName = null;
  if (mediaId) {
    try {
      const tableName = mediaType === "Manga" ? "Manga" : "Anime";
      const row = await queryOne(
        `SELECT folder_name FROM ${tableName} WHERE id = ? OR LOWER(id) = LOWER(?) LIMIT 1`,
        [mediaId, mediaId],
      );
      if (row && row.folder_name) {
        existingFolderName = row.folder_name;
      }
    } catch (_) {}
  }

  if (existingFolderName) {
    const targetDir = path.join(parentDir, existingFolderName);
    if (create && !fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }
    return targetDir;
  }

  const folderName = sanitizeFolderName(title);
  const targetDir = path.join(parentDir, folderName);
  if (create && !fs.existsSync(targetDir)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  if (mediaId) {
    try {
      const tableName = mediaType === "Manga" ? "Manga" : "Anime";
      await run(
        `UPDATE ${tableName} SET folder_name = ? WHERE id = ? AND (folder_name IS NULL OR folder_name = '')`,
        [folderName, mediaId],
      );
    } catch (_) {}
  }

  return targetDir;
}

// Dir GET
async function GetDir(title, customdir, Type, mediaId = null, create = false) {
  let destination;
  if (customdir) {
    try {
      await fs.promises.access(customdir);
      destination = customdir;
    } catch (err) {
      if (err.code === "ENOENT") {
        destination = getDownloadsFolder();
      }
    }
  } else {
    destination = getDownloadsFolder();
  }

  const Directory = path.join(destination, `./${Type}`);
  if (create) {
    try {
      await fs.promises.access(Directory);
    } catch (error) {
      if (error.code === "ENOENT") {
        await fs.promises.mkdir(Directory, { recursive: true });
      }
    }
    const dirNomedia = path.join(Directory, ".nomedia");
    if (!fs.existsSync(dirNomedia)) {
      try {
        fs.writeFileSync(dirNomedia, "");
      } catch (_) {}
    }
  }

  return await getOrCreateMediaDir(Directory, title, mediaId, Type, create);
}

// Anime Dir Maker
async function directoryMaker(title, ep, customdir, mediaId = null) {
  return await GetDir(title, customdir, "Anime", mediaId, true);
}

// Manga Dir Maker
async function MangaDir(title, customdir, mediaId = null) {
  return await GetDir(title, customdir, "Manga", mediaId, true);
}

// download folder Location
function getDownloadsFolder() {
  return (
    process.env.STRAWVERSE_PUBLIC_ROOT ||
    process.env.NODEJS_MOBILE_DATA_DIR ||
    path.join(os.homedir(), "Downloads")
  );
}

// Check Path Exists
async function ensureDirectoryExists(directoryPath) {
  if (!path.isAbsolute(directoryPath)) {
    throw new Error("Invalid directory path");
  }
  try {
    await fs.promises.access(directoryPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        await fs.promises.mkdir(directoryPath, { recursive: true });
      } catch (mkdirErr) {
        throw new Error("Invalid directory path");
      }
    } else {
      throw new Error("Invalid directory path");
    }
  }
}

module.exports = {
  sanitizeFolderName,
  directoryMaker,
  MangaDir,
  ensureDirectoryExists,
  getDownloadsFolder,
  GetDir,
};
