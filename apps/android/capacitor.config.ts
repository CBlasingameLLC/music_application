import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app is the web build, bundled.
 *
 * `webDir` is the static export (`pnpm --filter @etude/web build:native`). It is
 * copied into the APK's assets and served by Capacitor's own asset server at
 * `https://localhost`, so the app opens with no network and no server — the same
 * "works with the wifi off" the service worker gives the browser version.
 */
const config: CapacitorConfig = {
  // Cannot change once people have installed it: Android treats a different id
  // as a different app, with none of the first one's data.
  appId: 'app.etude.practice',
  appName: 'Étude',
  webDir: '../web/out',

  // What the WebView paints before the page does. The default is white, which
  // shows as a flash on a dark app.
  backgroundColor: '#0d0f14',

  server: {
    androidScheme: 'https',
    // Shown by Capacitor when it judges the device's WebView unusable. The page
    // also guards itself (see `unsupported.html`); this covers the cases where
    // the WebView is too old to run the page's own guard.
    errorPath: 'unsupported.html',
  },

  android: {
    allowMixedContent: false,
  },

  plugins: {
    // Capacitor's own plugin owns the system bars, and the app asks it to hide
    // them. It has to be the plugin: on load it *posts* a call that shows the
    // bars, which lands after anything an activity does in `onCreate`, so hiding
    // them there as well made the bars go hidden, shown, hidden while the page was
    // still being laid out. Two owners of one setting is a race; one is not.
    SystemBars: {
      hidden: true,
      // Light icons, for the moment the bars are swiped in over a dark app.
      style: 'DARK',
      // The page asks for `viewport-fit=cover`. Saying so up front stops the
      // layout being corrected after the first paint.
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
