import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

/**
 * The service worker is what makes Étude usable on a tablet with the wifi off,
 * which is the normal case at a piano. Serwist precaches the Next build output
 * (hashed chunk names and all), which is the part that is genuinely hard to
 * hand-roll.
 */
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Registering by hand in the client keeps the timing under our control.
  register: false,
  reloadOnOnline: false,
  disable: process.env.NODE_ENV === 'development',
});

/**
 * The Android app bundles the site inside the APK instead of loading it from a
 * server, which means a static export: plain files in `out/` that the app's
 * WebView serves to itself. `pnpm build:native` sets this; a normal build is
 * unaffected.
 *
 * Two things follow from it. `trailingSlash` makes every route a directory with
 * an `index.html`, which is the one layout a WebView's asset server resolves
 * without help. And there is no service worker: the APK *is* the offline cache,
 * and a worker caching an older copy of files that an app update just replaced
 * is exactly how an update fails to show.
 */
const native = process.env.ETUDE_TARGET === 'native';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @etude/core ships TypeScript source rather than a build artifact, so the
  // monorepo needs no build step and edits are picked up immediately.
  transpilePackages: ['@etude/core', '@etude/content'],
  typedRoutes: false,
  // Client code branches on this (no service worker in the APK), and `env` is
  // the one place that inlines it for every route at build time.
  env: { NEXT_PUBLIC_ETUDE_TARGET: native ? 'native' : 'web' },
  ...(native ? { output: 'export', trailingSlash: true, images: { unoptimized: true } } : {}),
};

export default native ? nextConfig : withSerwist(nextConfig);
