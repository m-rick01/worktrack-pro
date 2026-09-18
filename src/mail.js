// Minimal SMTP client (no external deps) supporting implicit TLS (465) and
// STARTTLS (587/25), with AUTH LOGIN. Good enough for typical cPanel mailboxes.
const net = require('node:net');
const tls = require('node:tls');

function readLine(stream) {
  return new Promise((resolve, reject) => {
    let buf = '';
    function onData(chunk) {
      buf += chunk.toString('utf8');
      if (buf.includes('\r\n')) {
        cleanup();
        resolve(buf);
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
    }
    stream.on('data', onData);
    stream.on('error', onError);
  });
}

async function expect(stream, codes) {
  const line = await readLine(stream);
  const code = parseInt(line.slice(0, 3), 10);
  if (!codes.includes(code)) {
    throw new Error(`SMTP unexpected response: ${line.trim()}`);
  }
  return line;
}

function write(stream, data) {
  return new Promise((resolve, reject) => {
    stream.write(data, (err) => (err ? reject(err) : resolve()));
  });
}

function b64(s) {
  return Buffer.from(s, 'utf8').toString('base64');
}

async function sendMail({ to, subject, text, html }) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!host || !user || !pass) {
    console.warn('[mail] SMTP not configured — skipping send. Would have emailed:', to, subject);
    return { skipped: true };
  }

  let socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });

  await new Promise((resolve, reject) => {
    socket.once(secure ? 'secureConnect' : 'connect', resolve);
    socket.once('error', reject);
  });

  await expect(socket, [220]);
  await write(socket, `EHLO ${host}\r\n`);
  await expect(socket, [250]);

  if (!secure) {
    await write(socket, 'STARTTLS\r\n');
    await expect(socket, [220]);
    const plainSocket = socket;
    socket = tls.connect({ socket: plainSocket, servername: host });
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve);
      socket.once('error', reject);
    });
    await write(socket, `EHLO ${host}\r\n`);
    await expect(socket, [250]);
  }

  await write(socket, 'AUTH LOGIN\r\n');
  await expect(socket, [334]);
  await write(socket, `${b64(user)}\r\n`);
  await expect(socket, [334]);
  await write(socket, `${b64(pass)}\r\n`);
  await expect(socket, [235]);

  await write(socket, `MAIL FROM:<${from}>\r\n`);
  await expect(socket, [250]);
  await write(socket, `RCPT TO:<${to}>\r\n`);
  await expect(socket, [250, 251]);
  await write(socket, 'DATA\r\n');
  await expect(socket, [354]);

  const bodyHtml = html || `<pre>${text || ''}</pre>`;
  const message =
    `From: ${from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${subject}\r\n` +
    'MIME-Version: 1.0\r\n' +
    'Content-Type: text/html; charset=UTF-8\r\n' +
    '\r\n' +
    bodyHtml.replace(/\r?\n\./g, '\r\n..') +
    '\r\n.\r\n';

  await write(socket, message);
  await expect(socket, [250]);
  await write(socket, 'QUIT\r\n');
  socket.end();
  return { sent: true };
}

module.exports = { sendMail };
