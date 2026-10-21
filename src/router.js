// Local model router: a proxy on 127.0.0.1 that Claude Code sends its API calls to when a helper runs on a local
// model. A subagent can't pick its own server, so the one server (ANTHROPIC_BASE_URL) does the choosing: calls for
// LOCAL_MODEL go to Ollama, which speaks the Anthropic API, and everything else goes to Anthropic unchanged,
// including the headers that carry the user's Claude login. Bodies and headers are never logged.
const http = require('http');
const https = require('https');

// The name helpers use, and the name `ollama create` gives the model (tools/local-model/Modelfile). The Modelfile
// raises the context window, because Claude Code's prompts don't fit Ollama's default.
const LOCAL_MODEL = 'lemon-qwen3-coder';
const OLLAMA = { protocol: 'http:', host: '127.0.0.1', port: 11434 };
const ANTHROPIC = { protocol: 'https:', host: 'api.anthropic.com', port: 443 };
const MAX_BODY_BYTES = 32 * 1024 * 1024;
// Connection-level headers aren't passed on. content-length is set again from the buffered body.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te',
  'trailer', 'content-length', 'host']);

// Anything that isn't a local-model call (a GET, a body without a model) keeps going to Anthropic.
function pickTarget(body, targets) {
  let model = null;
  try { model = JSON.parse(body).model; } catch { /* not JSON */ }
  return model === LOCAL_MODEL ? targets.local : targets.remote;
}

function copyHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) if (!HOP_BY_HOP.has(name)) out[name] = value;
  return out;
}

function forward(req, res, body, target, isLocal) {
  const headers = copyHeaders(req.headers);
  headers.host = target.host;
  headers['content-length'] = Buffer.byteLength(body);
  const lib = target.protocol === 'https:' ? https : http;
  const upstream = lib.request({ ...target, path: req.url, method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode, copyHeaders(upRes.headers));
    upRes.pipe(res);
  });
  // Esc in Claude stops the request; stop Ollama generating too rather than letting it run on.
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  upstream.on('error', (err) => {
    const message = isLocal && err.code === 'ECONNREFUSED'
      ? 'The local model is not running. Start Ollama, then try again.'
      : `Could not reach ${target.host} (${err.code || err.message}).`;
    console.warn(`LemonCode router: ${message}`);
    if (res.headersSent) return res.destroy();
    res.writeHead(isLocal ? 503 : 502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }));
  });
  upstream.end(body);
}

// Resolves with the server; its port goes in ANTHROPIC_BASE_URL. Tests pass fake servers as targets.
function startRouter(targets = { local: OLLAMA, remote: ANTHROPIC }) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413).end();
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        const body = Buffer.concat(chunks);
        const target = pickTarget(body, targets);
        forward(req, res, body, target, target === targets.local);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startRouter, LOCAL_MODEL, OLLAMA, ANTHROPIC };
