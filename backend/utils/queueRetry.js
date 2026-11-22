function isRetryableError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("queue paused") ||
    msg.includes("episode cancelled") ||
    msg.includes("data missing") ||
    msg.includes("type is not valid")
  ) {
    return false;
  }
  return (
    msg.includes("no_sources_available") ||
    msg.includes("slow_mirror_failover") ||
    msg.includes("scraper_temporary_error") ||
    msg.includes("stream link") ||
    msg.includes("resolution timeout") ||
    msg.includes("server resolution") ||
    msg.includes("failed to download") ||
    msg.includes("no stream url") ||
    msg.includes("no source link") ||
    msg.includes("no image found") ||
    msg.includes("cloudflare") ||
    msg.includes("err_address_unreachable") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("abort") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("403") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again")
  );
}

module.exports = { isRetryableError };
