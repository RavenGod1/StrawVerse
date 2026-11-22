const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

// The backend's runtime deps live in electron/node_modules — electron-builder
// packs them next to backend/ inside the asar, so point node there too before
// loading downloader (it requires iso-639-1 and friends).
process.env.NODE_PATH = [
  process.env.NODE_PATH,
  path.join(__dirname, "..", "..", "electron", "node_modules"),
]
  .filter(Boolean)
  .join(path.delimiter);
Module._initPaths();

const {
  downloader,
  withRangeCacheBuster,
  decodeDataUrl,
} = require("./downloader");

const BODY = Buffer.alloc(64 * 1024, 7);

function makeInstance() {
  const d = Object.create(downloader.prototype);
  d.headers = {};
  return d;
}

function parseRange(header) {
  const m = /bytes=(\d+)-(\d+)/.exec(header || "");
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/v.mp4` });
    });
  });
}

test("cache-busts AniXoHindi range requests without changing other hosts", () => {
  const source =
    "https://embed.anixohindi.cc/stream/v/token/part/play.mp4?md5=abc";
  const first = new URL(withRangeCacheBuster(source));
  const second = new URL(withRangeCacheBuster(source));

  assert.equal(first.pathname, "/stream/v/token/part/play.mp4");
  assert.equal(first.searchParams.get("md5"), "abc");
  assert.ok(first.searchParams.get("cb"));
  assert.notEqual(first.searchParams.get("cb"), second.searchParams.get("cb"));
  assert.equal(
    withRangeCacheBuster("https://example.com/video.mp4"),
    "https://example.com/video.mp4",
  );
});

test("rejects a ranged request the server answers with the whole file", async () => {
  // Behaves like the anixohindi CDN: advertises Accept-Ranges but ignores
  // Range and streams the entire object back as 200.
  const { server, url } = await listen((req, res) => {
    res.writeHead(200, {
      "Content-Length": BODY.length,
      "Accept-Ranges": "bytes",
      "Content-Type": "video/mp4",
    });
    res.end(BODY);
  });
  try {
    await assert.rejects(
      makeInstance().fetchDirectVideoRange(url, "bytes=0-1023", 5000),
      (err) => err.code === "RANGE_IGNORED",
    );
  } finally {
    server.close();
  }
});

test("resolves a real 206 part with exactly the requested bytes", async () => {
  const { server, url } = await listen((req, res) => {
    const [start, endRaw] = parseRange(req.headers.range);
    const end = Math.min(endRaw, BODY.length - 1);
    const slice = BODY.subarray(start, end + 1);
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${BODY.length}`,
      "Content-Length": slice.length,
      "Accept-Ranges": "bytes",
    });
    res.end(slice);
  });
  try {
    const res = await makeInstance().fetchDirectVideoRange(
      url,
      "bytes=0-1023",
      5000,
    );
    assert.equal(res.status, 206);
    assert.equal(res.data.length, 1024);
    assert.equal(res.headers["content-range"], `bytes 0-1023/${BODY.length}`);
  } finally {
    server.close();
  }
});

test("accepts a 200 that carries exactly the requested range", async () => {
  // Legal per RFC 7233: a server may answer with 200 when it sends the
  // bytes that were asked for. Only sending MORE than asked is a refusal.
  const { server, url } = await listen((req, res) => {
    const [start, endRaw] = parseRange(req.headers.range);
    const end = Math.min(endRaw, BODY.length - 1);
    const slice = BODY.subarray(start, end + 1);
    res.writeHead(200, {
      "Content-Length": slice.length,
      "Accept-Ranges": "bytes",
    });
    res.end(slice);
  });
  try {
    const res = await makeInstance().fetchDirectVideoRange(
      url,
      "bytes=0-1023",
      5000,
    );
    assert.equal(res.status, 200);
    assert.equal(res.data.length, 1024);
  } finally {
    server.close();
  }
});

test("multi-part download falls back to sequential parts when parallel ranges stall", async () => {
  // The anixohindi CDN answers one ranged part at a time and lets every
  // concurrent one idle out, which used to kill the whole task.
  const TOTAL = 12 * 1024 * 1024; // 3 parts at the downloader's 5 MB chunk size
  const FULL = Buffer.alloc(TOTAL, 9);

  const d = Object.create(downloader.prototype);
  Object.assign(d, {
    headers: {},
    streamUrl: "http://stream.test/v.mp4",
    subtitles: [],
    EpID: "ep-stall",
    caption: "Downloading stall test",
    currentSegments: 0,
    totalSegments: 0,
    downloadedTotalBytes: 0,
  });

  let inFlight = 0;
  let stallRaised = false;
  d.fetchDirectVideoRange = async (_url, rangeHeader, timeoutMs) => {
    const m = /bytes=(\d+)-(\d+)/.exec(rangeHeader || "");
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (rangeHeader === "bytes=0-0") {
      return {
        status: 206,
        headers: { "content-range": `bytes 0-0/${TOTAL}` },
        data: Buffer.alloc(1),
      };
    }
    if (end - start + 1 > 1024) {
      inFlight += 1;
      if (inFlight > 1) {
        inFlight -= 1;
        stallRaised = true;
        throw new Error(`Timeout of ${timeoutMs}ms exceeded`);
      }
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
    }
    return {
      status: 206,
      headers: {},
      data: FULL.subarray(start, Math.min(end, TOTAL - 1) + 1),
    };
  };

  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "strawverse-partstall-"),
  );
  try {
    const targetFile = path.join(directory, "out.mp4");
    await d.downloadDirectVideoMultiPart(
      targetFile,
      `${targetFile}.downloading`,
      path.join(directory, ".temp_out"),
    );
    assert.equal(stallRaised, true, "expected a parallel stall to be detected");
    assert.deepEqual(await fs.promises.readFile(targetFile), FULL);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});

test("saves a base64 data subtitle without making an HTTP request", async () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n";
  const dataUrl = `data:text/vtt;base64,${Buffer.from(vtt).toString("base64")}`;
  assert.equal(decodeDataUrl(dataUrl), vtt);

  const directory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "strawverse-subtitle-"),
  );
  const instance = Object.create(downloader.prototype);
  Object.assign(instance, {
    subtitles: [{ url: dataUrl, lang: "English" }],
    directory,
    Epnum: "1",
    ChangeTosrt: false,
    MergeSubtitles: false,
    fileBase: null,
    mp4: null,
    downloadedPaths: [],
    currentSegments: 0,
    getMediaRequestHeaders: async () => {
      throw new Error("data subtitles must not use the HTTP transport");
    },
  });

  try {
    await instance.CheckSubtitles();
    const subtitlePath = path.join(directory, "subs", "1Ep.en.vtt");
    assert.equal(await fs.promises.readFile(subtitlePath, "utf8"), vtt);
    assert.equal(instance.downloadedPaths[0].path, subtitlePath);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
});
