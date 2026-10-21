// Run with `npm test`. Checks the keypresses that answer Claude Code's question dialog from the chat's card.
// The expected keys are the ones that worked when driving the real dialog (see src/questions.js).
const test = require('node:test');
const assert = require('node:assert');
const { questionKeys } = require('../src/questions');

const DOWN = '\x1b[B';
const one = (labels) => ({ question: 'Pick one?', multiSelect: false, options: labels.map((label) => ({ label })) });
const many = (labels) => ({ question: 'Pick some?', multiSelect: true, options: labels.map((label) => ({ label })) });

test('a single one-pick question is answered by Enter on its row, with no review screen', () => {
  assert.deepStrictEqual(questionKeys([one(['Small', 'Large'])], [{ picks: [1] }]), [DOWN, '\r']);
});

test('two questions: one-pick, then ticks and Submit, then the review screen', () => {
  const keys = questionKeys([one(['Apple', 'Pear']), many(['Red', 'Green', 'Blue'])], [{ picks: [1] }, { picks: [1, 0] }]);
  assert.deepStrictEqual(keys, [DOWN, '\r', ' ', DOWN, ' ', DOWN, DOWN, DOWN, '\r', '\r']);
});

test('typed answers go in on the "Type something" row', () => {
  const keys = questionKeys([one(['Apple', 'Pear']), many(['Red', 'Green', 'Blue'])],
    [{ picks: [2], text: 'kiwi fruit' }, { picks: [2, 3], text: 'pink' }]);
  assert.deepStrictEqual(keys, [DOWN, DOWN, 'kiwi fruit', '\r', DOWN, DOWN, ' ', DOWN, 'pink', DOWN, '\r', '\r']);
});

test('a question with previews has no "Type something" row to pick', () => {
  const q = { question: 'Which style?', multiSelect: false, options: [{ label: 'Plain', preview: '- a' }, { label: 'Fancy', preview: '<div>hi</div>' }] };
  assert.deepStrictEqual(questionKeys([q], [{ picks: [1] }]), [DOWN, '\r']);
  assert.throws(() => questionKeys([q], [{ picks: [2], text: 'mine' }]), /isn't one of its options/);
});

test('answers that do not fit the questions are refused', () => {
  const qs = [one(['Apple', 'Pear'])];
  assert.throws(() => questionKeys(qs, []), /don't match/);
  assert.throws(() => questionKeys(qs, [{ picks: [0, 1] }]), /Pick one/);
  assert.throws(() => questionKeys(qs, [{ picks: [5] }]), /isn't one of its options/);
  assert.throws(() => questionKeys(qs, [{ picks: [2], text: 'two\nlines' }]), /one line/);
});
