// Small HTTP response helpers.
function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

// On a live HTTPS site the session cookie must never travel over plain http,
// where it could be read off the wire and replayed. Keyed off APP_URL rather
// than hardcoded, so local development over http still works.
function secureCookies() {
  return String(process.env.APP_URL || '').startsWith('https://');
}

function setCookie(res, name, value, { maxAgeSeconds, httpOnly = true } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secureCookies()) cookie += '; Secure';
  if (maxAgeSeconds) cookie += `; Max-Age=${maxAgeSeconds}`;
  const existing = res.getHeader('Set-Cookie');
  if (existing) {
    res.setHeader('Set-Cookie', Array.isArray(existing) ? [...existing, cookie] : [existing, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

function clearCookie(res, name) {
  // Attributes must match the cookie that was set, or the browser keeps it.
  res.setHeader('Set-Cookie', `${name}=; Path=/; SameSite=Lax${secureCookies() ? '; Secure' : ''}; Max-Age=0`);
}

module.exports = { sendJson, sendError, setCookie, clearCookie };
