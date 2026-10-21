// Local model router: a proxy on 127.0.0.1 that Claude Code sends its API calls to when a helper runs on a local
// model. A subagent can't pick its own server, so the one server (ANTHROPIC_BASE_URL) does the choosing: calls for
// LOCAL_MODEL go to Ollama, which speaks the Anthropic API, and everything else goes to Anthropic unchanged,
// including the headers that carry the user's Claude login. Bodies and headers are never logged.
const http = require('http');
const https = require('https');

// The name helpers use, and the name `ollama create` gives the model (tools/local-model/Modelfile). The Modelfile
// raises the context window, because Claude Code's prompts don't fit Ollama's default.
const LOCAL_MODEL = 'lemon-gpt-oss-20b';
// Claude Code doesn't know LOCAL_MODEL, so it assumes a 200k window. This must match num_ctx in the Modelfile.
const LOCAL_CONTEXT_TOKENS = 65536;
const OLLAMA = { protocol: 'http:', host: '127.0.0.1', port: 11434 };
const ANTHROPIC = { protocol: 'https:', host: 'api.anthropic.com', port: 443 };
const MAX_BODY_BYTES = 32 * 1024 * 1024;
// Connection-level headers aren't passed on. content-length is set again from the buffered body.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te',
  'trailer', 'content-length', 'host']);

// Claude Code sends the session's or helper's effort as output_config.effort, and Ollama makes it gpt-oss's
// thinking level. On a small coding task gpt-oss "high" thought for over a minute and hit 8,000 tokens without
// answering (medium ~7 s, low ~2 s), so Claude's names move one step down: Claude's usual "high" is gpt-oss medium.
const LOCAL_EFFORT = { low: 'low', medium: 'low', high: 'medium', xhigh: 'high', max: 'high' };

function parseRequest(body) {
  try { return JSON.parse(body); } catch { return null; } // a GET, or not JSON
}

// The body for Ollama: the same bytes unless there's an effort to move down.
function localBody(body, request) {
  const effort = request.output_config && request.output_config.effort;
  if (!LOCAL_EFFORT[effort]) return body;
  return JSON.stringify({ ...request, output_config: { ...request.output_config, effort: LOCAL_EFFORT[effort] } });
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
        // Anything that isn't a local-model call (a GET, a body without a model) keeps going to Anthropic unchanged.
        const body = Buffer.concat(chunks);
        const request = parseRequest(body);
        if (request && request.model === LOCAL_MODEL) forward(req, res, localBody(body, request), targets.local, true);
        else forward(req, res, body, targets.remote, false);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

module.exports = { startRouter, LOCAL_MODEL, LOCAL_CONTEXT_TOKENS, OLLAMA, ANTHROPIC };
