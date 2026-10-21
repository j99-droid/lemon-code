// Tests that local-model calls are counted apart from Claude calls in the usage meter (src/usage.js).
const test = require('node:test');
const assert = require('node:assert');
const { Usage } = require('../src/usage');
const { LOCAL_MODEL } = require('../src/router');

function line(model, id, usage) {
  return JSON.stringify({
    type: 'assistant', sessionId: 's1', requestId: `r-${id}`, timestamp: new Date().toISOString(),
    message: { id, model, usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 5,
      cache_read_input_tokens: 1000, ...usage } },
  });
}

test('local-model calls are kept out of the Claude totals', () => {
  const usage = new Usage();
  usage.ingest(line('claude-haiku-5-5', 'm1'));
  usage.ingest(line(LOCAL_MODEL, 'm2', { input_tokens: 7000, output_tokens: 300 }));
  const s = usage.summary();
  assert.strictEqual(s.today.main, 100 + 20 + 5);
  assert.strictEqual(s.today.cacheRead, 1000);
  assert.strictEqual(s.sessions.s1, 125);
  assert.deepStrictEqual(
    { main: s.localToday.main, input: s.localToday.input, output: s.localToday.output },
    { main: 7000 + 300 + 5, input: 7000, output: 300 },
  );
});

test('a day with only local calls shows no Claude usage', () => {
  const usage = new Usage();
  usage.ingest(line(LOCAL_MODEL, 'm3'));
  const s = usage.summary();
  assert.strictEqual(s.today.main, 0);
  assert.strictEqual(s.fiveHour, null);
  assert.strictEqual(s.localToday.main, 125);
  assert.strictEqual(s.localWindow.main, 125);
});

test('a window counts only entries from its start and splits them by model', () => {
  const usage = new Usage();
  const hourMs = 3600 * 1000;
  const at = (hoursAgo) => new Date(Date.now() - hoursAgo * hourMs).toISOString();
  const old = JSON.parse(line('claude-haiku-5-5', 'old'));
  old.timestamp = at(10);
  usage.ingest(JSON.stringify(old));
  usage.ingest(line('claude-haiku-5-5', 'm4'));
  usage.ingest(line('claude-opus-5', 'm5', { output_tokens: 80 }));
  const s = usage.summary({ fiveHour: Date.now() - 5 * hourMs });
  assert.strictEqual(s.fiveHour.main, 125 + 185);
  assert.deepStrictEqual(s.fiveHour.byModel, { 'claude-haiku-5-5': 125, 'claude-opus-5': 185 });
  assert.strictEqual(s.week, null);
});
