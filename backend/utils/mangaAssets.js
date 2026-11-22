const path = require("path");

const MIME_TYPES = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  jxl: "image/jxl",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const EXTENSION_ALIASES = {
  jpeg: "jpg",
  "svg+xml": "svg",
};

function normalizeExtension(extension) {
  const normalized = String(extension || "")
    .trim()
    .toLowerCase()
    .replace(/^\./, "");
  return EXTENSION_ALIASES[normalized] || normalized;
}

function getMangaAssetExtension(source) {
  const value = String(source || "").trim();
  if (!value) return null;

  const dataMatch = value.match(/^data:image\/([a-z0-9.+-]+)/i);
  if (dataMatch) return normalizeExtension(dataMatch[1]) || null;

  let pathname = value.split(/[?#]/, 1)[0];
  try {
    if (/^https?:\/\//i.test(value)) pathname = new URL(value).pathname;
  } catch (_) {}

  return normalizeExtension(path.extname(pathname)) || null;
}

function getMangaAssetMimeType(source) {
  const extension = getMangaAssetExtension(source);
  return extension ? MIME_TYPES[extension] || null : null;
}

module.exports = { getMangaAssetExtension, getMangaAssetMimeType };
