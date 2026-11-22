/**
 * Is this page running inside the Android app, or in a browser?
 *
 * The APK is a WebView around the same site, so almost nothing needs to know.
 * The few things that do are the ones a WebView lacks: a service worker (the
 * APK bundles its own files), a browser toolbar to hide, an install prompt, and
 * a way to download a file.
 *
 * The answer comes from `window.Capacitor`, which the app's native side injects
 * into the page before any script runs. Reading it directly rather than
 * importing `@capacitor/core` keeps the ordinary web build free of a runtime it
 * would never use; a browser has no such object, and the check is false.
 */

interface CapacitorGlobal {
  readonly isNativePlatform?: () => boolean;
  readonly getPlatform?: () => string;
}

const capacitor = (): CapacitorGlobal | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

export function isNativeApp(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** `android` inside the app, `web` anywhere else. */
export function nativePlatform(): string {
  return isNativeApp() ? capacitor()?.getPlatform?.() ?? 'native' : 'web';
}

/**
 * Whether this *build* is the one bundled into the APK.
 *
 * Distinct from {@link isNativeApp}: that asks where the page is running, this
 * asks what was built. The APK build has no service worker file at all, so
 * anything that would register one has to know at build time rather than find
 * out from a 404.
 */
export const NATIVE_BUILD = process.env.NEXT_PUBLIC_ETUDE_TARGET === 'native';
