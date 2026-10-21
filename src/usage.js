// Reads Claude Code's transcripts (~/.claude/projects/**/*.jsonl) for token usage and the session list.
// Every Claude Code session writes here, including the desktop app's, so the meter sees all usage.
// Calls to the local model (router.js) run on this PC, so they are counted apart from the Claude numbers.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const { LOCAL_MODEL } = require('./router');

const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const KEEP_DAYS = 15;
const WINDOW_MS = 5 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

const dayKey = (t) => new Date(t).toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
const floorHour = (t) => { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); };

// Pro limits run in 5-hour windows that start with the first message after the last one ended.
// Returns null when no window is open now. Entries must be sorted by time.
function fiveHourWindow(entries, now) {
  let start = null;
  for (const e of entries) if (start === null || e.ts >= start + WINDOW_MS) start = floorHour(e.ts);
  if (start === null || now >= start + WINDOW_MS) return null;
  const main = entries.filter((e) => e.ts >= start).reduce((s, e) => s + e.input + e.output + e.cacheWrite, 0);
  return { start, end: start + WINDOW_MS, main };
}

class Usage extends EventEmitter {
  constructor() {
    super();
    this.files = new Map();    // path -> { offset, rest }
    this.messages = new Map(); // messageId:requestId -> { ts, session, input, output, cacheWrite, cacheRead }
    this.timer = null;
    this.pending = null;
  }

  start() {
    this.scan();
    try {
      fs.watch(PROJECTS, { recursive: true }, (_e, name) => {
        if (name && name.endsWith('.jsonl')) this.soon();
      });
    } catch { /* watch unsupported: the interval below still catches up */ }
    this.timer = setInterval(() => this.scan(), 15000);
  }

  soon() {
    if (this.pending) return;
    this.pending = setTimeout(() => { this.pending = null; this.scan(); }, 400);
  }

  listJsonl(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) this.listJsonl(p, out);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
    return out;
  }

  scan() {
    const cutoff = Date.now() - KEEP_DAYS * DAY_MS;
    let changed = false;
    for (const file of this.listJsonl(PROJECTS)) {
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      const known = this.files.get(file) || { offset: 0, rest: '' };
      if (st.size < known.offset) { known.offset = 0; known.rest = ''; } // file was rewritten
      if (st.size === known.offset) { this.files.set(file, known); continue; }
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(st.size - known.offset);
      fs.readSync(fd, buf, 0, buf.length, known.offset);
      fs.closeSync(fd);
      known.offset = st.size;
      const lines = (known.rest + buf.toString('utf8')).split('\n');
      known.rest = lines.pop();
      this.files.set(file, known);
      for (const line of lines) if (this.ingest(line)) changed = true;
    }
    this.prune(cutoff);
    if (changed || !this.sent) { this.sent = true; this.emit('update', this.summary()); }
  }

  ingest(line) {
    if (!line.includes('"usage"')) return false;
    let j;
    try { j = JSON.parse(line); } catch { return false; }
    const m = j.message;
    if (j.type !== 'assistant' || !m || !m.usage || !j.timestamp) return false;
    const u = m.usage;
    const key = `${m.id}:${j.requestId || ''}`;
    const entry = {
      ts: Date.parse(j.timestamp),
      session: j.sessionId,
      local: m.model === LOCAL_MODEL,
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
    };
    const old = this.messages.get(key);
    // Streaming writes one line per content block with the same id; keep the most complete.
    if (old && old.output >= entry.output) return false;
    this.messages.set(key, entry);
    const text = Array.isArray(m.content) && m.content.find((c) => c.type === 'text' && c.text);
    if (text && !old) this.emit('assistant-text', { session: j.sessionId, text: text.text });
    return true;
  }

  prune(cutoff) {
    for (const [k, v] of this.messages) if (v.ts < cutoff) this.messages.delete(k);
  }

  // main = input + output + cache writes. Cache reads are cheap and reported separately.
  summary() {
    const now = Date.now();
    const today = dayKey(now);
    const days = {};
    const sessions = {};
    const entries = [...this.messages.values()].sort((a, b) => a.ts - b.ts);
    const zero = () => ({ main: 0, cacheRead: 0, input: 0, output: 0, cacheWrite: 0 });
    const add = (d, e) => {
      d.main += e.input + e.output + e.cacheWrite;
      d.cacheRead += e.cacheRead; d.input += e.input; d.output += e.output; d.cacheWrite += e.cacheWrite;
    };
    const claude = entries.filter((e) => !e.local);
    const local = entries.filter((e) => e.local);
    const localToday = zero();
    for (const e of entries) if (e.local && dayKey(e.ts) === today) add(localToday, e);
    for (const e of claude) {
      const k = dayKey(e.ts);
      add(days[k] || (days[k] = zero()), e);
      if (e.session) sessions[e.session] = (sessions[e.session] || 0) + e.input + e.output + e.cacheWrite;
    }

    // Past days, newest first, today excluded.
    const past = [];
    for (let i = 1; i <= 14; i++) {
      const k = dayKey(now - i * DAY_MS);
      past.push({ day: k, main: days[k] ? days[k].main : 0 });
    }
    const avg7 = past.slice(0, 7).reduce((s, d) => s + d.main, 0) / 7;
    const active14 = past.filter((d) => d.main > 0);
    const avg14active = active14.length ? active14.reduce((s, d) => s + d.main, 0) / active14.length : 0;

    const win = fiveHourWindow(claude, now);
    const localWindow = fiveHourWindow(local, now);

    const t = days[today] || zero();
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const hours = Math.max(1, (now - midnight.getTime()) / 3600000);
    return {
      today: t,
      localToday,
      localWindow,
      projection: Math.round((t.main / hours) * 24),
      avg7: Math.round(avg7),
      avg14active: Math.round(avg14active),
      history: past.slice(0, 7).reverse(),
      window: win,
      sessions,
      at: now,
    };
  }

  // Recent sessions for the sidebar: newest first, with folder and first prompt.
  listSessions(limit = 40) {
    let dirs;
    try { dirs = fs.readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
    const files = [];
    for (const d of dirs) {
      const dir = path.join(PROJECTS, d.name);
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        const p = path.join(dir, f);
        try { files.push({ p, id: f.slice(0, -6), mtime: fs.statSync(p).mtimeMs }); } catch { /* gone */ }
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    const out = [];
    for (const f of files) {
      if (out.length >= limit) break;
      const info = this.sessionInfo(f.p);
      if (!info.cwd || !info.title) continue; // empty or never-used sessions
      out.push({ id: f.id, mtime: f.mtime, ...info });
    }
    return out;
  }

  sessionInfo(file) {
    let head = '';
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(96 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      head = buf.toString('utf8', 0, n);
    } catch { return {}; }
    let cwd = null, title = null, summary = null;
    for (const line of head.split('\n')) {
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.type === 'summary' && j.summary) summary = j.summary;
      if (!cwd && j.cwd) cwd = j.cwd;
      if (!title && j.type === 'user' && !j.isMeta && j.message) {
        const c = j.message.content;
        const s = typeof c === 'string' ? c : Array.isArray(c) ? (c.find((x) => x.type === 'text') || {}).text : null;
        if (s && !s.startsWith('<') && !s.startsWith('Caveat:')) title = s.replace(/\s+/g, ' ').trim().slice(0, 90);
      }
      if (cwd && title) break;
    }
    return { cwd, title: summary || title };
  }
}

module.exports = { Usage, PROJECTS };
