// Service worker for WorkTrack Pro.
//
// It exists so the app can be installed to a phone or computer, and to replace
// the browser's generic error page with a readable one when there is no network.
//
// It deliberately caches nothing. Timesheets are live data, and a worker that
// kept copies of the script or of API responses could show someone yesterday's
// hours, or keep serving an old version of the app after a deploy. So every
// request goes to the network as it always did; the only thing this adds is a
// fallback page for a page load that fails.
//
// Requests under /api/ are never touched, so sign-in, saving an entry and the
// CSV/PDF downloads behave exactly as without a worker.

const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WorkTrack Pro — offline</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #f7f8fa; color: #1a1d21; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 340px; padding: 24px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #6b7280; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  button { background: #14213d; color: #fff; border: 0; border-radius: 8px; padding: 12px 20px; font-size: 15px; font-weight: 600; }
</style></head>
<body><main>
  <h1>You're offline</h1>
  <p>WorkTrack needs a connection to load and save your hours. Nothing you entered has been lost — check your connection and try again.<br><br>
     Vous êtes hors ligne. Vérifiez votre connexion et réessayez.</p>
  <button onclick="location.reload()">Try again / Réessayer</button>
</main></body></html>`;

self.addEventListener('install', () => {
  // Nothing to precache, so there is no reason to wait for old tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clear anything an earlier version of this worker may have cached.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return; // sign-in, entries, downloads: leave alone

  // Only page loads get the fallback. Scripts, styles and images that fail are
  // left to fail normally rather than being answered with an HTML page.
  if (request.mode !== 'navigate') return;

  event.respondWith(
    fetch(request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        })
    )
  );
});
