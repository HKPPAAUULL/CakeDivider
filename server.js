// Zero-dependency local server.
//   http://localhost:8080   -> for the computer itself
//   https://<LAN-IP>:8443   -> for phones on the same Wi-Fi (camera requires HTTPS)
// A self-signed certificate is generated into ./certs via `openssl` on first run.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 8080;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 8443;
const CERT_DIR = path.join(ROOT, 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

function handler(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT) || file.startsWith(CERT_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function ensureCert() {
  if (fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE)) return true;
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const san = ['DNS:localhost', 'IP:127.0.0.1', ...lanAddresses().map((ip) => `IP:${ip}`)].join(',');
  try {
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', KEY_FILE, '-out', CERT_FILE,
      '-subj', '/CN=CakeDivider Local', '-addext', `subjectAltName=${san}`,
    ], { stdio: 'ignore' });
    return true;
  } catch {
    console.warn('! openssl not found; HTTPS disabled. Install openssl or place key.pem/cert.pem in ./certs');
    return false;
  }
}

function listen(server, port, onReady, attempts = 20) {
  const ready = () => onReady(port);
  server.once('listening', ready);
  server.once('error', (err) => {
    server.off('listening', ready);
    if (err.code === 'EADDRINUSE' && attempts > 1) {
      console.warn(`! Port ${port} in use, trying ${port + 1}...`);
      listen(server, port + 1, onReady, attempts - 1);
    } else {
      console.error(`! Cannot listen on port ${port}: ${err.message}`);
      process.exit(1);
    }
  });
  server.listen(port);
}

listen(http.createServer(handler), HTTP_PORT, (port) => {
  console.log(`HTTP : http://localhost:${port}`);
});

if (ensureCert()) {
  const server = https.createServer({ key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) }, handler);
  listen(server, HTTPS_PORT, (port) => {
    console.log(`HTTPS: https://localhost:${port}`);
    lanAddresses().forEach((ip) => console.log(`Phone: https://${ip}:${port}  (accept the certificate warning)`));
  });
}
