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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @etude/core ships TypeScript source rather than a build artifact, so the
  // monorepo needs no build step and edits are picked up immediately.
  transpilePackages: ['@etude/core'],
  typedRoutes: false,
};

export default withSerwist(nextConfig);
