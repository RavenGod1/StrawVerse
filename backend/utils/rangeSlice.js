// Slices a requested byte range out of an upstream response that ignored it
// (200 + full body from offset 0, no Content-Range). Origins like
// anixohindi's stream host do this, which makes lavf seeks fail
// ("Seek failed", "Invalid data found") and MPV stop mid-episode.
// Returns true when the response was written (206 or 416), false when the
// caller should fall back to plain passthrough (malformed range/size).
function pipeRangeSlice(upstream, res, opts) {
  const { start, end, total, contentType, headOnly } = opts || {};
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0
  ) {
    return false;
  }
  const clampedEnd = Math.min(end, total - 1);
  if (start >= total || clampedEnd < start) {
    upstream.destroy();
    res.status(416);
    res.setHeader("Content-Range", `bytes */${total}`);
    res.end();
    return true;
  }
  const take = clampedEnd - start + 1;
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${clampedEnd}/${total}`);
  res.setHeader("Content-Length", take);
  res.setHeader("Accept-Ranges", "bytes");
  if (contentType) res.setHeader("Content-Type", contentType);
  if (headOnly) {
    upstream.destroy();
    res.end();
    return true;
  }
  let skip = start;
  let sent = 0;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    res.end();
  };
  upstream.on("data", (chunk) => {
    let piece = chunk;
    if (skip > 0) {
      const s = Math.min(skip, piece.length);
      skip -= s;
      piece = piece.subarray(s);
      if (!piece.length) return;
    }
    if (sent >= take) {
      // Origin keeps streaming the full body after our slice is complete;
      // without ending here the range request would hang forever.
      upstream.destroy();
      finish();
      return;
    }
    if (sent + piece.length > take) {
      piece = piece.subarray(0, take - sent);
    }
    sent += piece.length;
    if (!res.write(piece)) upstream.pause();
  });
  res.on("drain", () => upstream.resume());
  upstream.on("end", finish);
  upstream.on("error", finish);
  res.on("close", () => upstream.destroy());
  return true;
}

module.exports = { pipeRangeSlice };
