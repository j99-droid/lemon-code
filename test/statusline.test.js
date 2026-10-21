// Tests that the status line's rate limits are read into percent + reset time in ms (src/statusline.js).
const test = require('node:test');
const assert = require('node:assert');
const { parseLimits } = require('../src/statusline');

test('both windows are read, with reset times in milliseconds', () => {
  const limits = parseLimits({
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: 1700000000 },
      seven_day: { used_percentage: 41, resets_at: 1700500000 },
    },
  });
  assert.deepStrictEqual(limits, {
    fiveHour: { percent: 23.5, resetsAt: 1700000000000 },
    week: { percent: 41, resetsAt: 1700500000000 },
  });
});

test('a window with a bad percent or no reset time is dropped', () => {
  const limits = parseLimits({
    rate_limits: {
      five_hour: { used_percentage: 130, resets_at: 1700000000 },
      seven_day: { used_percentage: 41 },
    },
  });
  assert.strictEqual(limits, null);
  assert.deepStrictEqual(
    parseLimits({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 1700000000 }, seven_day: null } }),
    { fiveHour: { percent: 10, resetsAt: 1700000000000 } },
  );
});

test('no rate limits, or an empty object, gives null', () => {
  assert.strictEqual(parseLimits({ model: 'x' }), null);
  assert.strictEqual(parseLimits({ rate_limits: {} }), null);
  assert.strictEqual(parseLimits(null), null);
});
