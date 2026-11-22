const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getMangaAssetExtension,
  getMangaAssetMimeType,
} = require("./mangaAssets");

test("detects Manga assets from data URLs and remote paths", () => {
  assert.equal(
    getMangaAssetExtension("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    "svg",
  );
  assert.equal(
    getMangaAssetMimeType("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
    "image/svg+xml",
  );
  assert.equal(getMangaAssetExtension("https://example.com/page.avif?x=1"), "avif");
  assert.equal(getMangaAssetMimeType("https://example.com/page.jxl?token=x"), "image/jxl");
  assert.equal(getMangaAssetExtension("1.jpeg"), "jpg");
  assert.equal(getMangaAssetMimeType("1.jpeg"), "image/jpeg");
});
