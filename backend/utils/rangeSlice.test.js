const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { pipeRangeSlice } = require("./rangeSlice");

const BODY = Buffer.from(
  Array.from({ length: 1000 }, (_, i) => i % 251),
);

function makeRes() {
  const chunks = [];
  let resolveFinished;
  const finished = new Promise((resolve) => {
    resolveFinished = resolve;
  });
  const res = {
    statusCode: null,
    headers: {},
    ended: false,
    finished,
    status(code) {
      res.statusCode = code;
      return res;
    },
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end() {
      res.ended = true;
      resolveFinished();
    },
    on() {
      return res;
    },
    body() {
      return Buffer.concat(chunks);
    },
  };
  return res;
}

// Upstream emits the body in small chunks so skip/trim boundaries are crossed.
function upstream() {
  return Readable.from(
    (function* () {
      for (let i = 0; i < BODY.length; i += 64) {
        yield BODY.subarray(i, i + 64);
      }
    })(),
  );
}

function run(opts) {
  const up = upstream();
  const res = makeRes();
  const handled = pipeRangeSlice(up, res, opts);
  // Wait for the response to finish (or a short cap for decline/416 paths).
  return Promise.race([
    res.finished,
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]).then(() => ({ handled, res, up }));
}

test("bounded range: slices exactly the requested bytes as 206", async () => {
  const { handled, res } = await run({
    start: 100,
    end: 199,
    total: BODY.length,
    contentType: "video/mp4",
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes 100-199/${BODY.length}`);
  assert.equal(res.headers["content-length"], 100);
  assert.equal(res.headers["content-type"], "video/mp4");
  assert.equal(res.ended, true);
  assert.deepEqual(res.body(), BODY.subarray(100, 200));
});

test("open-ended range: slices from start to EOF", async () => {
  const { res } = await run({
    start: 900,
    end: BODY.length - 1,
    total: BODY.length,
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes 900-999/${BODY.length}`);
  assert.deepEqual(res.body(), BODY.subarray(900));
});

test("end beyond total: clamps to total - 1", async () => {
  const { res } = await run({
    start: 990,
    end: 5000,
    total: BODY.length,
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes 990-999/${BODY.length}`);
  assert.equal(res.headers["content-length"], 10);
  assert.deepEqual(res.body(), BODY.subarray(990));
});

test("start at or past EOF: answers 416 with no body", async () => {
  const { res } = await run({
    start: BODY.length,
    end: BODY.length + 50,
    total: BODY.length,
  });
  assert.equal(res.statusCode, 416);
  assert.equal(res.headers["content-range"], `bytes */${BODY.length}`);
  assert.equal(res.ended, true);
  assert.equal(res.body().length, 0);
});

test("malformed size: declines so the caller can fall back", async () => {
  const { handled, res } = await run({ start: 10, end: 20, total: NaN });
  assert.equal(handled, false);
  assert.equal(res.statusCode, null);
  assert.equal(res.ended, false);
});

test("headOnly: sets 206 headers and ends without a body", async () => {
  const { res } = await run({
    start: 100,
    end: 199,
    total: BODY.length,
    headOnly: true,
  });
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers["content-range"], `bytes 100-199/${BODY.length}`);
  assert.equal(res.ended, true);
  assert.equal(res.body().length, 0);
});
