// Chat view feed: follows one session's transcript and pulls out only what you and Claude said.
// Tool calls, tool output, thinking, helper (sidechain) work and Claude Code's own bookkeeping are skipped.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PROJECTS } = require('./usage');

const POLL_MS = 500;
// User lines Claude Code writes itself: slash-command echoes, local command output, reminders.
const INTERNAL_USER_TEXT = /^\s*(<(command-|local-command-|system-reminder|bash-|task-notification|user-memory)|Caveat:)/;
const INTERRUPTED = /^\[Request interrupted by user/;

const blockText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n') : '');

// One transcript line -> { id, role: 'user' | 'assistant' | 'note', text }, or null if it isn't chat.
function chatMessage(line) {
  let j;
  try { j = JSON.parse(line); } catch { return null; }
  if (!j.message || j.isSidechain || j.isMeta || j.isCompactSummary) return null;
  const content = j.message.content;
  if (j.type === 'user') {
    const text = blockText(content).trim(); // tool results are user lines too, with no text blocks
    if (!text || INTERNAL_USER_TEXT.test(text)) return null;
    return { id: j.uuid, role: INTERRUPTED.test(text) ? 'note' : 'user', text };
  }
  if (j.type !== 'assistant' || !Array.isArray(content)) return null;
  // Claude's questions arrive as a tool call, not text, so show them as what Claude said.
  const ask = content.find((b) => b.type === 'tool_use' && b.name === 'AskUserQuestion');
  if (ask && ask.input && Array.isArray(ask.input.questions)) {
    return { id: j.uuid, role: 'assistant', text: ask.input.questions.map((q) => q.question).join('\n\n'), ask: true };
  }
  const text = blockText(content).trim();
  return text ? { id: j.uuid, role: 'assistant', text } : null;
}

function findTranscript(sessionId) {
  let dirs;
  try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    const p = path.join(PROJECTS, d.name, `${sessionId}.jsonl`);
    if (d.isDirectory() && fs.existsSync(p)) return p;
  }
  return null;
}

// Emits 'messages' with each batch of new chat messages. The file may not exist yet when a session
// starts (Claude writes it on the first message), so it keeps looking until it does.
class ChatFeed extends EventEmitter {
  constructor(sessionId) {
    super();
    this.sessionId = sessionId;
    this.file = null;
    this.offset = 0;
    this.rest = Buffer.alloc(0); // bytes after the last newline; kept as bytes so a split character survives
    this.timer = null;
  }

  // Separate from the constructor so the caller can listen before the first read sends the history.
  start() {
    this.timer = setInterval(() => this.read(), POLL_MS);
    this.read();
  }

  read() {
    if (!this.file) this.file = findTranscript(this.sessionId);
    if (!this.file) return;
    let size;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.offset) { this.offset = 0; this.rest = Buffer.alloc(0); } // file was rewritten
    if (size === this.offset) return;
    const buf = Buffer.alloc(size - this.offset);
    const fd = fs.openSync(this.file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, this.offset); } finally { fs.closeSync(fd); }
    this.offset = size;
    const bytes = Buffer.concat([this.rest, buf]);
    const end = bytes.lastIndexOf(0x0a);
    this.rest = bytes.subarray(end + 1);
    if (end < 0) return;
    const messages = bytes.toString('utf8', 0, end).split('\n').map(chatMessage).filter(Boolean);
    if (messages.length) this.emit('messages', messages);
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { ChatFeed, chatMessage };
