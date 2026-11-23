package app.strawverse.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class PlayerActivityTest {
    @Test
    public void detectsHlsManifestPathsWithAndWithoutExtensions() {
        assertTrue(PlayerActivity.isHlsUrl("https://anixo.buzz/api/stream/m3u8?t=token"));
        assertTrue(PlayerActivity.isHlsUrl("https://play.zephyrix.org/cdn/hls/hash/master.m3u8?token"));
        assertTrue(PlayerActivity.isHlsUrl("https://example.com/master.M3U8"));
    }

    @Test
    public void rejectsMediaSegmentsThatOnlyContainM3u8() {
        assertFalse(PlayerActivity.isHlsUrl("https://example.com/segment/m3u8/0001.ts"));
        assertFalse(PlayerActivity.isHlsUrl("https://example.com/video.mp4"));
        assertFalse(PlayerActivity.isHlsUrl(null));
    }

    @Test
    public void serverLabelShowsQualityAndExtensionServerName() {
        assertEquals(
                "Server 1 (Sora Edge) (1080p)",
                PlayerActivity.buildServerLabel("Server 1 (Sora Edge)", "1080p", 0, false, "anixo"));

        assertEquals(
                "Anixo 1 (720p)",
                PlayerActivity.buildServerLabel("", "720p", 0, false, "anixo"));

        assertEquals(
                "Anixo 2 (1080p)",
                PlayerActivity.buildServerLabel("", "1080p", 1, false, "anixo"));

        assertEquals("Local", PlayerActivity.buildServerLabel("Local", "", 0, false, "anixo"));
        assertEquals("Local", PlayerActivity.buildServerLabel("Server 1", "1080p", 0, true, "anixo"));
        assertEquals("Server 3", PlayerActivity.buildServerLabel("", "", 2, false, "anixo"));
    }
}
