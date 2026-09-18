const { loadEnv } = require('./env');
loadEnv();

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const url = require('node:url');

const auth = require('./auth');
const { handleApi } = require('./api');
const { sendError } = require('./http');

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, ''); // e.g. "/timesheet" or ""
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveIndexHtml(res) {
  // Inject the configured base path so client-side JS knows how to prefix API calls
  // when the app is mounted under a subpath (e.g. orthoclic.ca/timesheet).
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) {
      res.writeHead(500);
      return res.end('Failed to load index.html');
    }
    // Rewrite root-relative asset paths so they resolve correctly regardless of
    // whether the page was requested with or without a trailing slash on BASE_PATH.
    const injected = html
      .replace('href="css/styles.css"', `href="${BASE_PATH}/css/styles.css"`)
      .replace('src="js/app.js"', `src="${BASE_PATH}/js/app.js"`)
      .replace(
        '</head>',
        `<script>window.APP_BASE = ${JSON.stringify(BASE_PATH)};</script></head>`
      );
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(injected);
  });
}

function serveStatic(req, res, relPath) {
  if (relPath === 'index.html' || relPath === '') return serveIndexHtml(res);
  let filePath = path.join(PUBLIC_DIR, relPath);
  // Prevent path traversal.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendError(res, 403, 'Forbidden');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: serve index.html for unknown non-API GET routes.
      return serveIndexHtml(res);
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname = url.parse(req.url).pathname;

  // Strip configured base path so the app can be mounted under a subpath
  // (e.g. orthoclic.ca/timesheet) on the hosting provider.
  if (BASE_PATH) {
    if (pathname === BASE_PATH) pathname = '/';
    else if (pathname.startsWith(BASE_PATH + '/')) pathname = pathname.slice(BASE_PATH.length);
    else {
      // Request outside our mounted base path — 404 (including bare "/").
      res.writeHead(404);
      return res.end('Not found');
    }
  }
  req.url = pathname + (req.url.includes('?') ? '?' + req.url.split('?')[1] : '');

  const cookies = auth.parseCookies(req);
  const sessionToken = cookies.session;
  const user = auth.getUserBySession(sessionToken);
  const ctx = { user, sessionToken };

  if (pathname.startsWith('/api/')) {
    const handled = await handleApi(req, res, ctx);
    if (!handled) sendError(res, 404, 'Not found');
    return;
  }

  if (req.method === 'GET') {
    return serveStatic(req, res, pathname === '/' ? 'index.html' : pathname);
  }

  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`WorkTrack Pro listening on port ${PORT} (base path: "${BASE_PATH || '/'}")`);
});
