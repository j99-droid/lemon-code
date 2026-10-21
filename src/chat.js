// Chat view feed: follows one session's transcript and pulls out what you, Claude and its helpers said.
// Tool output, thinking and Claude Code's own bookkeeping are skipped. A helper (subagent) writes its own
// transcript to <session>/subagents/agent-<id>.jsonl, and its .meta.json names which helper it is.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { PROJECTS } = require('./usage');
const { describeTool } = require('./activity');

const POLL_MS = 500;
// User lines Claude Code writes itself: slash-command echoes, local command output, reminders.
const INTERNAL_USER_TEXT = /^\s*(<(command-|local-command-|system-reminder|bash-|task-notification|user-memory)|Caveat:)/;
const INTERRUPTED = /^\[Request interrupted by user/;
// A helper's final report arrives as this internal tool's input. Feedback to the main Claude is plumbing: hidden.
const HANDBACK_TOOL = 'SubagentHandback';
const HIDDEN_TOOL = 'SendFeedback';
const HELPER_FILE = /^agent-([\w-]+)\.jsonl$/;

const blockText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b.type === 'text' && b.text).map((b) => b.text).join('\n\n') : '');

const plainIdentity = (agentType) => ({ key: agentType, name: agentType || 'Helper', icon: '🤖' });

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function questionOf(q) {
  return {
    question: String(q.question || ''), header: String(q.header || ''), multiSelect: !!q.multiSelect,
    options: (Array.isArray(q.options) ? q.options : []).map((o) => ({
      label: String(o.label || ''), description: String(o.description || ''), preview: o.preview ? String(o.preview) : null,
    })),
  };
}

// One parsed transcript line -> { id, role: 'user' | 'assistant' | 'note', text }, or null if it isn't chat.
function toChat(j) {
  if (!j.message || j.isSidechain || j.isMeta || j.isCompactSummary) return null;
  const content = j.message.content;
  if (j.type === 'user') {
    const text = blockText(content).trim(); // tool results are user lines too, with no text blocks
    if (!text || INTERNAL_USER_TEXT.test(text)) return null;
    return { id: j.uuid, role: INTERRUPTED.test(text) ? 'note' : 'user', text };
  }
  if (j.type !== 'assistant' || !Array.isArray(content)) return null;
  // Claude's questions arrive as a tool call. The chat shows them as a card you can answer, see questions.js.
  const ask = content.find((b) => b.type === 'tool_use' && b.name === 'AskUserQuestion');
  if (ask && ask.input && Array.isArray(ask.input.questions)) {
    const questions = ask.input.questions.map(questionOf);
    return { id: j.uuid, role: 'assistant', text: questions.map((q) => q.question).join('\n\n'), ask: true,
      toolUseId: ask.id, questions };
  }
  const text = blockText(content).trim();
  return text ? { id: j.uuid, role: 'assistant', text } : null;
}

function chatMessage(line) {
  const j = parseLine(line);
  return j ? toChat(j) : null;
}

// What one helper line says in the chat: its words, its report, or what it is doing with a tool.
function helperMessages(j, who, helperName) {
  if (j.type !== 'assistant' || !Array.isArray(j.message && j.message.content)) return [];
  const out = [];
  j.message.content.forEach((b, i) => {
    const id = `${j.uuid}-${i}`;
    if (b.type === 'text') {
      if (b.text && b.text.trim()) out.push({ id, role: 'helper', kind: 'text', text: b.text.trim(), helper: who });
      return;
    }
    if (b.type !== 'tool_use' || b.name === HIDDEN_TOOL) return;
    if (b.name === HANDBACK_TOOL) {
      const report = b.input && typeof b.input.message === 'string' ? b.input.message.trim() : '';
      if (report) out.push({ id, role: 'helper', kind: 'text', text: report, helper: who });
      return;
    }
    out.push({ id, role: 'helper', kind: 'tool', text: describeTool(b.name, b.input, helperName), helper: who });
  });
  return out;
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

// Reads the whole lines added to a file since the last read. Bytes after the last newline wait for the next read.
class LineTail {
  constructor(file) {
    this.file = file;
    this.offset = 0;
    this.rest = Buffer.alloc(0); // kept as bytes so a character split across two reads survives
  }

  read() {
    let size;
    try { size = fs.statSync(this.file).size; } catch { return []; }
    if (size < this.offset) { this.offset = 0; this.rest = Buffer.alloc(0); } // file was rewritten
    if (size === this.offset) return [];
    const buf = Buffer.alloc(size - this.offset);
    const fd = fs.openSync(this.file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, this.offset); } finally { fs.closeSync(fd); }
    this.offset = size;
    const bytes = Buffer.concat([this.rest, buf]);
    const end = bytes.lastIndexOf(0x0a);
    this.rest = bytes.subarray(end + 1);
    if (end < 0) return [];
    return bytes.toString('utf8', 0, end).split('\n').filter(Boolean);
  }
}

// Missing or half-written: the caller tries again on the next poll.
function readMeta(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// One helper run per agent file. Its lines wait until the meta file says which helper it is, because the
// transcript can appear before the meta file does.
class HelperFeed {
  // identify(agentType) gives { key, name, icon } for a helper you set up, or null for any other subagent.
  constructor(dir, identify) {
    this.dir = dir;
    this.identify = (agentType) => identify(agentType) || plainIdentity(agentType);
    this.runs = new Map(); // agent id -> { tail, meta, started, done }
  }

  // Returns [{ ts, message }] for everything new since the last read.
  read() {
    let names;
    try { names = fs.readdirSync(this.dir); } catch { return []; }
    const out = [];
    for (const name of names) {
      const m = HELPER_FILE.exec(name);
      if (!m) continue;
      const id = m[1];
      if (!this.runs.has(id)) this.runs.set(id, { tail: new LineTail(path.join(this.dir, name)), meta: null, started: false, done: false });
      const run = this.runs.get(id);
      if (run.done) continue;
      run.meta = readMeta(path.join(this.dir, `agent-${id}.meta.json`)) || run.meta;
      if (!run.meta) continue;
      out.push(...this.readRun(id, run));
    }
    return out;
  }

  readRun(id, run) {
    const out = [];
    const identity = this.identify(run.meta.agentType);
    const who = { run: id, ...identity };
    const helperName = (key) => this.identify(key).name;
    let ts = 0;
    for (const line of run.tail.read()) {
      const j = parseLine(line);
      if (!j) continue;
      ts = Date.parse(j.timestamp) || ts;
      // The first line is the task the main Claude gave the helper.
      if (!run.started) {
        run.started = true;
        out.push({ ts, message: { id: `${id}-start`, role: 'helper', kind: 'start', text: run.meta.description || '', helper: who } });
        continue;
      }
      for (const message of helperMessages(j, who, helperName)) out.push({ ts, message });
    }
    if (run.meta.finished && run.started) {
      run.done = true;
      out.push({ ts, message: { id: `${id}-done`, role: 'helper', kind: 'done', text: '', helper: who } });
    }
    return out;
  }
}

// Emits 'messages' with each batch of new chat messages, in the order they were written. The transcript may not
// exist yet when a session starts (Claude writes it on the first message), so it keeps looking until it does.
class ChatFeed extends EventEmitter {
  constructor(sessionId, identify = () => null) {
    super();
    this.sessionId = sessionId;
    this.identify = identify;
    this.file = null;
    this.tail = null;
    this.helpers = null;
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
    if (!this.tail) {
      this.tail = new LineTail(this.file);
      this.helpers = new HelperFeed(path.join(path.dirname(this.file), this.sessionId, 'subagents'), this.identify);
    }
    const items = [];
    let ts = 0;
    for (const line of this.tail.read()) {
      const j = parseLine(line);
      if (!j) continue;
      ts = Date.parse(j.timestamp) || ts;
      const message = toChat(j);
      if (message) items.push({ ts, message });
    }
    items.push(...this.helpers.read());
    if (!items.length) return;
    // Your words, Claude's and the helpers' are merged by time, so a resumed session reads in order.
    this.emit('messages', items.sort((a, b) => a.ts - b.ts).map((x) => x.message));
  }

  stop() { clearInterval(this.timer); }
}

module.exports = { ChatFeed, chatMessage };
