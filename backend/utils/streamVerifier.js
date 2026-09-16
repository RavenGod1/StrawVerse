const axios = require("axios");

async function verifyStreamReachability(streamUrl, headers = {}) {
  if (!streamUrl || !streamUrl.startsWith("http")) return { ok: true };
  const client = global.axios || axios;
  try {
    const probeRes = await client.get(streamUrl, {
      headers,
      timeout: 4000,
      skipBypass: true,
      validateStatus: (status) => status < 400,
    });
    if (probeRes.status >= 400) {
      return {
        ok: false,
        status: probeRes.status,
        message: `HTTP ${probeRes.status}`,
      };
    }

    if (
      typeof probeRes.data === "string" &&
      probeRes.data.includes("#EXTM3U")
    ) {
      const lines = probeRes.data
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      let mediaPlaylistUrl = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
          if (i + 1 < lines.length && !lines[i + 1].startsWith("#")) {
            mediaPlaylistUrl = new URL(lines[i + 1], streamUrl).href;
            break;
          }
        }
      }

      if (mediaPlaylistUrl) {
        try {
          const subRes = await client.get(mediaPlaylistUrl, {
            headers,
            timeout: 3000,
            skipBypass: true,
            validateStatus: (s) => s < 400,
          });
          if (subRes.status >= 400) {
            return {
              ok: false,
              status: subRes.status,
              message: `sub-playlist HTTP ${subRes.status}`,
            };
          }
        } catch (subErr) {
          return {
            ok: false,
            status: subErr.response?.status,
            message: `sub-playlist failed (${subErr.response?.status ? `HTTP ${subErr.response.status}` : subErr.message})`,
          };
        }
      }
    }

    return { ok: true };
  } catch (probeErr) {
    return {
      ok: false,
      status: probeErr.response?.status,
      message: probeErr.response?.status
        ? `HTTP ${probeErr.response.status}`
        : probeErr.message,
    };
  }
}

module.exports = { verifyStreamReachability };
