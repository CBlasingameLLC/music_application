package app.etude.practice;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/**
 * The whole app is the web build; the native side adds two things the web build
 * cannot do for itself.
 *
 * <b>Borderless.</b> The system bars are hidden, and a swipe from the edge brings
 * them back for a moment. A practice app lives on a music desk, where the status
 * bar and the three navigation buttons are chrome around a score, not content.
 * This is the Android equivalent of an iOS home-screen app opening with nothing
 * around it — the thing a browser tab, or a PWA whose browser will not launch it
 * standalone, cannot give.
 *
 * The bars are hidden by Capacitor's own SystemBars plugin (see
 * {@code capacitor.config.ts}), not here. That plugin posts a call at load that
 * <em>shows</em> the bars, which runs after {@code onCreate}; hiding them in
 * {@code onCreate} as well meant two owners of one setting racing while the page
 * was being laid out. This class only sets how they come back (transiently, by
 * swipe) and hides them again after an interruption.
 *
 * <b>A route-aware asset server.</b> See {@link EtudeWebViewClient}.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().setWebViewClient(new EtudeWebViewClient(getBridge()));
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
            .setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    /**
     * The bars come back whenever the window regains focus — after a dialog, the
     * share sheet, a permission prompt — so hiding them once at startup would last
     * until the first interruption. Hiding what is already hidden is a no-op, so
     * this does not compete with the plugin's initial hide.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView())
                .hide(WindowInsetsCompat.Type.systemBars());
        }
    }
}
