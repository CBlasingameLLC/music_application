/**
 * Serves `out/` the way the Android app's WebView does.
 *
 * The static export is only half of the app; the other half is Capacitor's
 * asset server, and its routing rule is not the one a static host or `next
 * start` applies. In `WebViewLocalServer.handleLocalRequest`, with the default
 * `html5mode`:
 *
 *   - `/`, and any path whose last segment contains no ".", is answered with
 *     the root `index.html` — whatever the path was.
 *   - Anything else is looked up as a file in the bundled assets.
 *
 * So a full page load of `/library/` returns the home page's HTML, and only
 * client-side navigation (which fetches `/library/index.txt`, a path with a dot)
 * gets the right page. Testing the exported site on an ordinary server would
 * pass while the app misbehaved, so this server reproduces the rule instead.
 *
 * The app does not ship that rule as it is. `EtudeWebViewClient` in the Android
 * project sits in front of it and, for a path with no dot that names a bundled
 * directory, serves that directory's `index.html` — so `/library/` is the
 * library whether it was reached by a tap or by a reload. This server does the
 * same by default, and the two have to stay in step: change one, change both.
 *
 *   node scripts/serve-export.mjs [--port 3312] [--dir out] [--stock]
 *
 * `--stock` serves Capacitor's rule with nothing in front of it, which is what
 * the app would do without `EtudeWebViewClient`. It exists to show the bug the
 * client fixes, and for the test that proves the fix is needed.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const PORT = Number(flag('--port', process.env.PORT ?? '3312'));
const ROOT = resolve(flag('--dir', 'out'));
const STOCK = args.includes('--stock');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.xml': 'application/xml',
  '.musicxml': 'application/xml',
};

/** Capacitor's own rule: no dot in the last segment means the root page. */
function resolveStock(urlPath) {
  const last = urlPath.split('/').filter(Boolean).pop() ?? '';
  if (urlPath === '/' || !last.includes('.')) return join(ROOT, 'index.html');
  return join(ROOT, urlPath);
}

/** The shipped rule: stock, except a bundled directory serves its own page. */
function resolveShipped(urlPath) {
  const last = urlPath.split('/').filter(Boolean).pop() ?? '';
  if (urlPath !== '/' && !last.includes('.')) {
    const page = join(ROOT, urlPath, 'index.html');
    if (existsSync(page)) return page;
  }
  return resolveStock(urlPath);
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  let file;
  try {
    const path = decodeURIComponent(pathname);
    file = normalize(STOCK ? resolveStock(path) : resolveShipped(path));
  } catch {
    res.writeHead(400).end();
    return;
  }

  // Never serve outside the export, however the path is spelled.
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT} (${STOCK ? 'stock capacitor rule' : 'capacitor rule + directory pages'})`);
});
