// Answers from the chat's question card, turned into the keypresses Claude Code's question dialog reads.
// The dialog lists each question's options top to bottom, then "Type something" as the last row.
// Positions are counted from 0, so "Type something" is the position after the last option.
// How the dialog reacts to keys was found by driving claude.exe 2.1.306 in a PTY and replaying the screens:
// - each question starts with the cursor on its first row;
// - one-pick question: Enter on a row answers it and moves on;
// - many-pick question: Space ticks the row under the cursor, and a Submit row under "Type something" moves on;
// - typing while on "Type something" fills it in (and ticks it on a many-pick question);
// - with two or more questions a review screen comes last, with "Submit answers" already under the cursor;
// - a question whose options have previews shows them beside the list and has no "Type something" row.
const MAX_ANSWER_CHARS = 500;
const KEY_GAP_MS = 60;
const DOWN = '\x1b[B';
const ENTER = '\r';
const SPACE = ' ';

// Throws if the answers don't fit the questions Claude asked. Returns them in a clean form.
function checkAnswers(questions, answers) {
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error("The answers don't match the questions. Reload the chat and try again.");
  }
  return questions.map((q, qi) => {
    const a = answers[qi] || {};
    const typeRow = q.options.length;
    const lastRow = q.options.some((o) => o.preview) ? typeRow - 1 : typeRow; // previews: no "Type something" row
    const picks = [...new Set(Array.isArray(a.picks) ? a.picks : [])];
    if (!picks.length) throw new Error(`Pick an answer for "${q.question}".`);
    if (!q.multiSelect && picks.length !== 1) throw new Error(`Pick one answer for "${q.question}".`);
    if (!picks.every((p) => Number.isInteger(p) && p >= 0 && p <= lastRow)) {
      throw new Error(`That answer for "${q.question}" isn't one of its options.`);
    }
    const sorted = picks.sort((x, y) => x - y);
    let text = null;
    if (sorted.includes(typeRow)) {
      text = typeof a.text === 'string' ? a.text.trim() : '';
      if (!text || text.length > MAX_ANSWER_CHARS || /[\x00-\x1f\x7f]/.test(text)) {
        throw new Error(`Type your own answer for "${q.question}" (one line, up to ${MAX_ANSWER_CHARS} characters).`);
      }
    }
    return { picks: sorted, text };
  });
}

// The keys for one question, starting with the cursor on its first row.
function keysFor(question, { picks, text }) {
  const typeRow = question.options.length;
  const keys = [];
  let row = 0;
  const moveTo = (target) => { for (; row < target; row++) keys.push(DOWN); };
  for (const pick of picks) {
    moveTo(pick);
    if (pick === typeRow) keys.push(text);
    else if (question.multiSelect) keys.push(SPACE);
  }
  if (question.multiSelect) moveTo(typeRow + 1); // the Submit row
  keys.push(ENTER);
  return keys;
}

// Throws like checkAnswers. Each item is written to the terminal on its own, KEY_GAP_MS apart.
function questionKeys(questions, answers) {
  const clean = checkAnswers(questions, answers);
  const keys = questions.flatMap((q, i) => keysFor(q, clean[i]));
  if (questions.length > 1) keys.push(ENTER); // "Submit answers" on the review screen
  return keys;
}

module.exports = { checkAnswers, questionKeys, KEY_GAP_MS };
