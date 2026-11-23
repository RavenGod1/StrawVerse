package app.strawverse.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class CloudflareBypassPluginTest {
    @Test
    public void preservesExplicitProviderUserAgent() {
        String userAgent =
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.0.0 Mobile Safari/537.36";

        assertEquals(
            userAgent,
            CloudflareBypassPlugin.resolveUserAgent(
                userAgent,
                "Mozilla/5.0 fallback Version/4.0"
            )
        );
    }

    @Test
    public void recognizesCloudflareProtectedHosts() {
        assertEquals(
            true,
            WebViewRequestHelper.isCloudflareProtectedHost("manhwatop.com")
        );
        assertEquals(
            true,
            WebViewRequestHelper.isCloudflareProtectedHost("animepahe.pw")
        );
        assertEquals(
            false,
            WebViewRequestHelper.isCloudflareProtectedHost("example.com")
        );
    }

    @Test
    public void cleansOnlyTheFallbackUserAgent() {
        assertEquals(
            "Mozilla/5.0 fallback Chrome/1",
            CloudflareBypassPlugin.resolveUserAgent(
                "",
                "Mozilla/5.0 fallback Version/4.0 Chrome/1"
            )
        );
    }
}
