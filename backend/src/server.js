const http = require('http');
const config = require('./config');
const { attachWebSocketServer } = require('./wsServer');
const { createRegion, updateRegion, deleteRegion } = require('./regionRoutes');
const { createCommand, updateCommand, deleteCommand } = require('./commandRoutes');
const { createBatch, updateBatch, deleteBatch } = require('./batchRoutes');
const { createShare, deleteShare, listShareContext } = require('./shareRoutes');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', config.allowedOrigin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Route table: [method, path regex, handler]. Handlers receive
// (req, res, body, ...regexCaptureGroups).
const routes = [
  ['POST', /^\/regions$/, createRegion],
  ['PATCH', /^\/regions\/([a-zA-Z0-9-]+)$/, updateRegion],
  ['DELETE', /^\/regions\/([a-zA-Z0-9-]+)$/, deleteRegion],

  ['POST', /^\/commands$/, createCommand],
  ['PATCH', /^\/commands\/([a-zA-Z0-9-]+)$/, updateCommand],
  ['DELETE', /^\/commands\/([a-zA-Z0-9-]+)$/, deleteCommand],

  ['POST', /^\/batches$/, createBatch],
  ['PATCH', /^\/batches\/([a-zA-Z0-9-]+)$/, updateBatch],
  ['DELETE', /^\/batches\/([a-zA-Z0-9-]+)$/, deleteBatch],

  ['POST', /^\/shares$/, createShare],
  ['DELETE', /^\/shares$/, deleteShare],
  ['POST', /^\/shares\/list$/, listShareContext],
];

const server = http.createServer(async (req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  for (const [method, pattern, handler] of routes) {
    if (req.method !== method) continue;
    const match = req.url.match(pattern);
    if (!match) continue;

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    const captureGroups = match.slice(1);
    try {
      return await handler(req, res, body, ...captureGroups);
    } catch (err) {
      console.error('Unhandled route error:', err);
      if (!res.headersSent) {
        return sendJson(res, 500, { error: 'Internal server error' });
      }
      return;
    }
  }

  res.writeHead(404);
  res.end();
});

attachWebSocketServer(server);

// Last-resort safety net: log and keep running rather than crashing the
// whole process (and every in-flight SSH session) on an unexpected
// error somewhere we didn't anticipate. This is not a substitute for
// fixing the root cause — it's here so one bad request can't take down
// every other user's active session.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

server.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
});
