/**
 * Builds the static site the Android app bundles, and checks what came out.
 *
 *   pnpm build:native            clean build into out/
 *   pnpm build:native --verify   check an existing out/ without rebuilding
 *
 * Why a script rather than `ETUDE_TARGET=native next build`: the output is only
 * usable if a handful of properties hold, and each of them fails *quietly* — the
 * app installs, opens, and is subtly wrong. So the build is followed by checks
 * for exactly those:
 *
 *  - **No service worker.** A stale `public/sw.js` from an earlier web build
 *    would be copied into the export. Nothing registers it, but a worker file
 *    inside the APK is a trap for whoever later changes that. Removed before the
 *    build, asserted absent after.
 *  - **A flight payload beside every page.** Client-side navigation fetches
 *    `<route>/index.txt`. If one is missing, that route works from a cold start
 *    and breaks when reached from another page — which is how people use it.
 *  - **The pieces the shell needs**: the root page, the manifest, the icons.
 *
 * A clean `.next` and `out` are required too: a half-stale cache from a normal
 * web build is the other way an export comes out mixed.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
const verifyOnly = process.argv.includes('--verify');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

if (!verifyOnly) {
  for (const stale of ['.next', 'out']) rmSync(join(root, stale), { recursive: true, force: true });
  for (const file of readdirSync(join(root, 'public'))) {
    if (/^(sw\.js|sw\.js\.map|swe-worker-.*\.js)$/.test(file)) {
      rmSync(join(root, 'public', file), { force: true });
    }
  }

  const build = spawnSync('pnpm', ['exec', 'next', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ETUDE_TARGET: 'native' },
  });
  if (build.status !== 0) {
    console.error('\nnative build failed');
    process.exit(build.status ?? 1);
  }
}

const problems = [];
if (!existsSync(out)) {
  console.error(`no export at ${out}`);
  process.exit(1);
}

const files = walk(out).map((f) => relative(out, f));

for (const required of ['index.html', 'index.txt', 'manifest.webmanifest', 'icons/icon-512.png']) {
  if (!files.includes(required)) problems.push(`missing ${required}`);
}

for (const worker of files.filter((f) => /(^|\/)(sw\.js|swe-worker-[^/]*\.js)$/.test(f))) {
  problems.push(`service worker in the export: ${worker}`);
}

// `404/index.html` is the not-found page the export emits in directory form. It
// is never a navigation target, so it has no payload and needs none.
const pages = files.filter((f) => f.endsWith('/index.html') || f === 'index.html');
for (const page of pages.filter((f) => f !== '404/index.html')) {
  const payload = page.replace(/index\.html$/, 'index.txt');
  if (!files.includes(payload)) problems.push(`${page} has no ${payload} for client-side navigation`);
}

const bytes = files.reduce((sum, f) => sum + statSync(join(out, f)).size, 0);
console.log(
  `\nexport: ${pages.length} pages, ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`,
);
if (problems.length > 0) {
  for (const p of problems) console.error(`  PROBLEM  ${p}`);
  process.exit(1);
}
console.log('export checks passed');
