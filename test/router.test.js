// Tests for the local model router (src/router.js): which server each call goes to, and that nothing else changes.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { startRouter, LOCAL_MODEL } = require('../src/router');

// A fake upstream that records what it got and answers with a streamed reply.
function fakeUpstream(log) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        log.push({ url: req.url, method: req.method, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('event: message_start\n');
        res.end('data: done\n\n');
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const target = (server) => ({ protocol: 'http:', host: '127.0.0.1', port: server.address().port });
const stop = (server) => new Promise((r) => { server.closeAllConnections(); server.close(r); });

async function setup() {
  const localLog = [];
  const remoteLog = [];
  const local = await fakeUpstream(localLog);
  const remote = await fakeUpstream(remoteLog);
  const router = await startRouter({ local: target(local), remote: target(remote) });
  const close = () => Promise.all([router, local, remote].map(stop));
  return { port: router.address().port, localLog, remoteLog, close };
}

const call = (port, model) => fetch(`http://127.0.0.1:${port}/v1/messages`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'secret-key', 'anthropic-version': '2023-06-01' },
  body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] }),
});

test('a local-model call goes to the local server, with the body unchanged', async () => {
  const env = await setup();
  try {
    const body = JSON.stringify({ model: LOCAL_MODEL, max_tokens: 10, messages: [] });
    const res = await fetch(`http://127.0.0.1:${env.port}/v1/messages`, { method: 'POST', body });
    assert.strictEqual(await res.text(), 'event: message_start\ndata: done\n\n');
    assert.strictEqual(env.localLog.length, 1);
    assert.strictEqual(env.remoteLog.length, 0);
    assert.strictEqual(env.localLog[0].body, body);
  } finally {
    await env.close();
  }
});

test("a local-model call's effort moves one step down, since gpt-oss high runs away", async () => {
  const env = await setup();
  try {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const body = JSON.stringify({ model: LOCAL_MODEL, output_config: { effort }, messages: [] });
      await fetch(`http://127.0.0.1:${env.port}/v1/messages`, { method: 'POST', body });
    }
    assert.deepStrictEqual(env.localLog.map((x) => JSON.parse(x.body).output_config.effort),
      ['low', 'low', 'medium', 'high', 'high']);
  } finally {
    await env.close();
  }
});

test("a Claude call's effort is not touched", async () => {
  const env = await setup();
  try {
    const body = JSON.stringify({ model: 'claude-sonnet-5-5', output_config: { effort: 'high' }, messages: [] });
    await fetch(`http://127.0.0.1:${env.port}/v1/messages`, { method: 'POST', body });
    assert.strictEqual(env.remoteLog[0].body, body);
  } finally {
    await env.close();
  }
});

test('a Claude call goes to Anthropic, with its login headers passed on', async () => {
  const env = await setup();
  try {
    await call(env.port, 'claude-sonnet-5-5');
    assert.strictEqual(env.localLog.length, 0);
    assert.strictEqual(env.remoteLog.length, 1);
    const [seen] = env.remoteLog;
    assert.strictEqual(seen.url, '/v1/messages');
    assert.strictEqual(seen.headers['x-api-key'], 'secret-key');
    assert.strictEqual(seen.headers['anthropic-version'], '2023-06-01');
    assert.strictEqual(JSON.parse(seen.body).model, 'claude-sonnet-5-5');
  } finally {
    await env.close();
  }
});

test('a call with no body (or no model) goes to Anthropic', async () => {
  const env = await setup();
  try {
    await fetch(`http://127.0.0.1:${env.port}/v1/models`);
    assert.strictEqual(env.localLog.length, 0);
    assert.strictEqual(env.remoteLog.length, 1);
  } finally {
    await env.close();
  }
});

test('a stopped local model gives a 503 that says what to do', async () => {
  const closed = await fakeUpstream([]);
  const deadPort = closed.address().port;
  await new Promise((r) => closed.close(r));
  const remote = await fakeUpstream([]);
  const router = await startRouter({
    local: { protocol: 'http:', host: '127.0.0.1', port: deadPort },
    remote: target(remote),
  });
  try {
    const res = await call(router.address().port, LOCAL_MODEL);
    const json = await res.json();
    assert.strictEqual(res.status, 503);
    assert.match(json.error.message, /Start Ollama/);
  } finally {
    await Promise.all([router, remote].map(stop));
  }
});
