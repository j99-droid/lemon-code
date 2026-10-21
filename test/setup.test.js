// Tests for the getting-started checks (src/setup.js): what counts as ready, how Ollama's answer is read, and the
// PowerShell command that builds the local model.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { hasLocalModel, isReady, localOnlyEnv, ollamaModels, psQuote, modelSetupScript, MODES } = require('../src/setup');
const { LOCAL_MODEL } = require('../src/router');

const READY = { ollama: { installed: true, running: true, modelReady: true } };
const NOT_READY = { ollama: { installed: false, running: false, modelReady: false } };

test('the claude mode only needs Claude Code', () => {
  assert.strictEqual(isReady('claude', { claude: true, ...NOT_READY }), true);
  assert.strictEqual(isReady('claude', { claude: false, ...READY }), false);
});

test('local helpers need Claude Code and a running Ollama with the model', () => {
  assert.strictEqual(isReady('local-helpers', { claude: true, ...READY }), true);
  assert.strictEqual(isReady('local-helpers', { claude: true, ...NOT_READY }), false);
  const notRunning = { ollama: { installed: true, running: false, modelReady: true } };
  assert.strictEqual(isReady('local-helpers', { claude: true, ...notRunning }), false);
  const noModel = { ollama: { installed: true, running: true, modelReady: false } };
  assert.strictEqual(isReady('local-helpers', { claude: true, ...noModel }), false);
});

test('local only needs the Claude program and the local model, but no account', () => {
  assert.strictEqual(isReady('local', { claude: true, ...READY }), true);
  assert.strictEqual(isReady('local', { claude: false, ...READY }), false);
  assert.strictEqual(isReady('local', { claude: true, ...NOT_READY }), false);
});

test('no setup chosen is never ready', () => {
  assert.strictEqual(isReady(null, { claude: true, ...READY }), false);
  assert.deepStrictEqual(MODES, ['claude', 'local-helpers', 'local']);
});

test('the local-only environment sends every model name and call to the local router', () => {
  const env = localOnlyEnv(4321);
  assert.strictEqual(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:4321');
  for (const key of ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL']) {
    assert.strictEqual(env[key], LOCAL_MODEL, key);
  }
  assert.strictEqual(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
  assert.ok(!('ANTHROPIC_API_KEY' in env), 'a real key must not be passed in');
});

test('the model is found whatever tag Ollama lists it under', () => {
  assert.strictEqual(hasLocalModel([`${LOCAL_MODEL}:latest`]), true);
  assert.strictEqual(hasLocalModel([`${LOCAL_MODEL}-old:latest`, 'llama3:8b']), false);
  assert.strictEqual(hasLocalModel([]), false);
});

test('PowerShell quoting doubles single quotes', () => {
  assert.strictEqual(psQuote("C:\\Users\\O'Brien\\ollama.exe"), "'C:\\Users\\O''Brien\\ollama.exe'");
});

test('the model script pulls the base model, then builds the local one from the Modelfile', () => {
  const script = modelSetupScript('C:\\Programs\\ollama.exe');
  assert.match(script, /& 'C:\\Programs\\ollama\.exe' pull qwen3-coder:30b;/);
  assert.match(script, new RegExp(`create ${LOCAL_MODEL} -f '.*tools[\\\\/]local-model[\\\\/]Modelfile'`));
  assert.ok(script.includes('if ($?)'), 'a failed pull must stop the create step');
});

// A stand-in for Ollama's /api/tags, answering with whatever body the test gives.
function fakeOllama(body) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
const endpointOf = (server) => ({ host: '127.0.0.1', port: server.address().port });
const stop = (server) => new Promise((r) => { server.closeAllConnections(); server.close(r); });

test('ollamaModels reads the model names from the server', async () => {
  const server = await fakeOllama(JSON.stringify({ models: [{ name: `${LOCAL_MODEL}:latest` }, { name: 'llama3:8b' }] }));
  try {
    assert.deepStrictEqual(await ollamaModels(endpointOf(server)), [`${LOCAL_MODEL}:latest`, 'llama3:8b']);
  } finally { await stop(server); }
});

test('ollamaModels gives null when the answer is not Ollama', async () => {
  const server = await fakeOllama('<html>not ollama</html>');
  try {
    assert.strictEqual(await ollamaModels(endpointOf(server)), null);
  } finally { await stop(server); }
});

test('ollamaModels gives null when nothing is listening', async () => {
  const server = await fakeOllama('{}');
  const endpoint = endpointOf(server);
  await stop(server);
  assert.strictEqual(await ollamaModels(endpoint), null);
});
