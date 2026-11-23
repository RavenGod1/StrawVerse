const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  materializeSubtitleDataUrl,
  getMpvPlayerStatus,
} = require("./mpvPlayerUtils");

test("materializes a data URL subtitle into a short VTT file", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";
  const dataUrl = `data:text/vtt;base64,${Buffer.from(vtt).toString("base64")}`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "strawverse-mpv-sub-"));
  const subtitlePath = path.join(directory, "subtitle.vtt");

  try {
    assert.equal(materializeSubtitleDataUrl(dataUrl, subtitlePath), subtitlePath);
    assert.equal(fs.readFileSync(subtitlePath, "utf8"), vtt);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reports MPV liveness from the process and IPC client", () => {
  const liveProcess = { pid: 42, killed: false, exitCode: null, signalCode: null };
  const liveClient = { destroyed: false };

  assert.deepEqual(getMpvPlayerStatus(liveProcess, liveClient, { started: true }), {
    running: true,
    connected: true,
    ready: true,
    started: true,
    pid: 42,
    requestId: null,
    episode: null,
  });

  assert.equal(
    getMpvPlayerStatus(
      { ...liveProcess, exitCode: 1 },
      liveClient,
      { started: false },
    ).running,
    false,
  );
  assert.equal(
    getMpvPlayerStatus(liveProcess, { destroyed: true }).ready,
    false,
  );
});
