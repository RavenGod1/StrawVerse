const fs = require("fs");
const path = require("path");

let embeddedChangelog = "__EMBEDDED_CHANGELOG_PLACEHOLDER__";

function getChangelog() {
  if (
    embeddedChangelog &&
    embeddedChangelog !== "__EMBEDDED_CHANGELOG_PLACEHOLDER__"
  ) {
    return embeddedChangelog;
  }

  const changelogPath = path.resolve(__dirname, "../../changelog.md");
  if (fs.existsSync(changelogPath)) {
    try {
      return fs.readFileSync(changelogPath, "utf-8");
    } catch (_) {}
  }
  return "";
}

module.exports = { getChangelog };
