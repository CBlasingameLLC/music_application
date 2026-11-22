package app.etude.practice;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.util.Arrays;
import java.util.Map;

/**
 * Makes a full page load of a bundled route land on that route.
 *
 * Étude ships as a static export: every route is a directory holding an
 * {@code index.html} ({@code library/index.html}, {@code play/free/index.html}…).
 * Capacitor's asset server does not look for those. In
 * {@code WebViewLocalServer.handleLocalRequest}, with its default
 * {@code html5mode}, any path whose last segment has no "." is answered with the
 * <em>root</em> {@code index.html}, whatever the path was — the right rule for a
 * single-page app with one entry point, and the wrong one here.
 *
 * Most of the time it never shows, because moving between pages inside the app
 * is a client-side route change that fetches {@code library/index.txt} (a path
 * with a dot, so served normally). It shows on a full load: a reload, a hard
 * navigation, a deep link. The page then arrives as the home page's HTML at the
 * library's URL, the router disagrees with what it was served, and the drill
 * pages throw a hydration error on top.
 *
 * So: for a navigation to a path with no dot that names a bundled directory,
 * serve that directory's page. The WebView's address does not change — this
 * rewrites what is served, not where the page thinks it is — which is what the
 * router needs. Everything else, including {@code /} and paths that name nothing
 * at all, falls through to Capacitor unchanged, so the worst case is the
 * behaviour the app would have had without this class.
 *
 * {@code apps/web/scripts/serve-export.mjs} reproduces the same rule for the
 * desktop tests. Change one, change the other.
 */
public class EtudeWebViewClient extends BridgeWebViewClient {

    /** Where Capacitor keeps the web build inside the APK's assets. */
    private static final String ASSET_ROOT = "public";

    private final Bridge bridge;
    private final AssetManager assets;

    public EtudeWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.assets = bridge.getContext().getAssets();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceRequest page = directoryPage(request);
        return super.shouldInterceptRequest(view, page != null ? page : request);
    }

    /** The same request pointed at the directory's own page, or null to leave it alone. */
    private WebResourceRequest directoryPage(WebResourceRequest request) {
        try {
            Uri url = request.getUrl();
            if (!bridge.getHost().equalsIgnoreCase(url.getHost())) return null;

            String path = url.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) return null;

            String last = url.getLastPathSegment();
            if (last == null || last.indexOf('.') >= 0) return null;

            String directory = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
            String[] entries = assets.list(ASSET_ROOT + directory);
            if (entries == null || !Arrays.asList(entries).contains("index.html")) return null;

            return new Rewritten(request, url.buildUpon().path(directory + "/index.html").build());
        } catch (IOException | RuntimeException e) {
            // Never let the fix take the page down: fall back to the stock rule.
            return null;
        }
    }

    /** A request that is the original in every respect but its URL. */
    private static final class Rewritten implements WebResourceRequest {

        private final WebResourceRequest original;
        private final Uri url;

        Rewritten(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return original.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return original.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return original.hasGesture();
        }

        @Override
        public String getMethod() {
            return original.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return original.getRequestHeaders();
        }
    }
}
