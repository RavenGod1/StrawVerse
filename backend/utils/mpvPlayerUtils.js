const fs = require("fs");

function decodeDataUrl(value) {
  const match = String(value || "").match(/^data:([^,]*),(.*)$/s);
  if (!match) throw new Error("Invalid data URL");
  const [, metadata, payload] = match;
  if (/;base64/i.test(metadata)) {
    return Buffer.from(payload, "base64").toString("utf8");
  }
  return decodeURIComponent(payload);
}

function materializeSubtitleDataUrl(value, filePath) {
  if (!String(value || "").startsWith("data:")) return null;
  const content = decodeDataUrl(value);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

function isMpvProcessAlive(mpvProcess) {
  return Boolean(
    mpvProcess &&
      !mpvProcess.killed &&
      mpvProcess.exitCode === null &&
      mpvProcess.signalCode === null,
  );
}

function isMpvClientAlive(mpvClient) {
  return Boolean(mpvClient && !mpvClient.destroyed);
}

function getMpvPlayerStatus(mpvProcess, mpvClient, session = {}) {
  const processAlive = isMpvProcessAlive(mpvProcess);
  const clientAlive = isMpvClientAlive(mpvClient);
  return {
    running: processAlive,
    connected: clientAlive,
    ready: processAlive && clientAlive,
    started: Boolean(session?.started),
    pid: mpvProcess?.pid || null,
    requestId: session?.requestId || null,
    episode: session?.episode ?? null,
  };
}

module.exports = {
  decodeDataUrl,
  materializeSubtitleDataUrl,
  isMpvProcessAlive,
  isMpvClientAlive,
  getMpvPlayerStatus,
};
