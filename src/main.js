// Lemon Code main process: window, Claude Code terminals (node-pty), hook listener, usage meter, git.
const { app, BrowserWindow, ipcMain, Notification, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFile, execFileSync } = require('child_process');
const pty = require('@lydell/node-pty');
const { Usage } = require('./usage');
const { buildPrompt, folderName, AGENTS_SKELETON } = require('./templates');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json');
const HOOKS_FILE = path.join(app.getPath('userData'), 'hooks-settings.json');

// ---- config ---------------------------------------------------------------

const DEFAULTS = {
  dailyBudget: null, // null = use your 14-day average
  archived: [],
  model: 'default',
  effort: 'default',
  mode: 'default',
  projectsRoot: path.join(os.homedir(), 'Lemon Projects'),
  templates: [], // user-made, see templates.js
  agents: [], // helper agents: { id, key, name, role, prompt, model, effort }
  lastAgents: [], // helpers picked on the home page last time
  sessionAgents: {}, // session id -> agent ids, so a resumed session gets its helpers back
  claudePath: null,
};
let config = { ...DEFAULTS };
try { config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch { /* first run */ }
const saveConfig = () => {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};
function claudeExe() {
  if (config.claudePath && fs.existsSync(config.claudePath)) return config.claudePath;
  const native = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
  if (fs.existsSync(native)) return native;
  try { return execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

// ---- hooks: Claude Code -> local HTTP -> Citron ----------------------------

let hookPort = 0;
let win = null;
const send = (ch, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

function nodeExe() {
  try { return execFileSync('where', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

// A settings file passed with --settings, so only sessions started here get the hooks.
// Uses Node if installed, else Electron itself as Node (Claude Code runs hooks in Git Bash on Windows).
function writeHookSettings() {
  const fwd = (p) => p.replace(/\\/g, '/');
  const script = `"${fwd(path.join(__dirname, 'hook.js'))}"`;
  const node = process.env.LEMON_FORCE_ELECTRON_HOOK ? null : nodeExe();
  const command = node ? `"${fwd(node)}" ${script}` : `ELECTRON_RUN_AS_NODE=1 "${fwd(process.execPath)}" ${script}`;
  const h = [{ type: 'command', command, timeout: 5 }];
  const events = ['SessionStart', 'UserPromptSubmit', 'Stop', 'Notification', 'SessionEnd', 'SubagentStop'];
  const hooks = {};
  for (const e of events) hooks[e] = [{ hooks: h }];
  for (const e of ['PreToolUse', 'PostToolUse', 'PermissionRequest']) hooks[e] = [{ matcher: '*', hooks: h }];
  fs.mkdirSync(path.dirname(HOOKS_FILE), { recursive: true });
  fs.writeFileSync(HOOKS_FILE, JSON.stringify({ hooks }, null, 2));
}

const lastPing = new Map();
// Hook events are small JSON. The server only listens on 127.0.0.1, but any local process can post to it.
const MAX_HOOK_BYTES = 1024 * 1024;
function startHookServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => {
        body += d;
        if (body.length > MAX_HOOK_BYTES) req.destroy();
      });
      req.on('end', () => {
        res.end('ok');
        let j;
        try { j = JSON.parse(body); } catch { return; }
        const session = typeof j.session_id === 'string' ? j.session_id : null;
        const tabId = req.headers['x-lemon-tab'];
        const tab = tabs.get(tabId);
        if (tab && session) tab.sessionId = session;
        if (tab && session && j.hook_event_name === 'SessionStart' && tab.agentIds && tab.agentIds.length) rememberAgents(session, tab.agentIds);
        const ev = {
          tab: tabId, event: j.hook_event_name, tool: j.tool_name, input: j.tool_input,
          message: j.message, kind: j.notification_type, session: j.session_id, agentType: j.agent_type,
        };
        send('hook', ev);
        const wantsYou = ev.event === 'PermissionRequest'
          || (ev.event === 'Notification' && ev.kind !== 'idle_prompt');
        if (wantsYou) pingUser(tabId, ev);
      });
    });
    server.listen(0, '127.0.0.1', () => { hookPort = server.address().port; resolve(); });
  });
}

function rememberAgents(sessionId, ids) {
  if (!sessionId) return;
  config.sessionAgents[sessionId] = ids;
  const keys = Object.keys(config.sessionAgents);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete config.sessionAgents[k];
  saveConfig();
}

function pingUser(tabId, ev) {
  if (!win || win.isFocused()) return;
  const now = Date.now();
  if (now - (lastPing.get(tabId) || 0) < 8000) return; // PermissionRequest + Notification fire together
  lastPing.set(tabId, now);
  const tab = tabs.get(tabId);
  const what = ev.tool ? `Allow ${ev.tool}?` : (ev.message || 'Claude is waiting for you.');
  const n = new Notification({ title: `Citron needs you${tab ? ` · ${tab.title}` : ''}`, body: what, icon: iconPath() });
  n.on('click', () => { win.show(); win.focus(); send('focus-tab', tabId); });
  n.show();
}

// ---- terminals ------------------------------------------------------------

const tabs = new Map(); // id -> { pty, cwd, title, sessionId }
let nextTab = 1;

// If Lemon Code was started from inside another Claude session (e.g. the desktop app), that session's
// variables would make our Claude a "child": no transcripts, and traffic routed via the parent's proxy.
function cleanEnv() {
  const env = { ...process.env };
  if (!env.CLAUDECODE && !env.CLAUDE_CODE_ENTRYPOINT) return env;
  for (const k of Object.keys(env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID|CLAUDE_PREVIEW_)/.test(k) || k === 'ANTHROPIC_BASE_URL') delete env[k];
  }
  return env;
}

function spawnClaude({ cwd, title, prompt, resume, agentIds = [] }) {
  const exe = claudeExe();
  if (!exe) throw new Error("Claude Code isn't installed yet. Use the Install button on the home page.");
  const args = ['--settings', HOOKS_FILE];
  if (config.model && config.model !== 'default') args.push('--model', config.model);
  if (config.effort && config.effort !== 'default') args.push('--effort', config.effort);
  if (config.mode && config.mode !== 'default') args.push('--permission-mode', config.mode);
  const helpers = config.agents.filter((a) => agentIds.includes(a.id));
  if (helpers.length) args.push('--agents', JSON.stringify(agentsJson(helpers)), '--append-system-prompt', helperHint(helpers));
  if (resume) args.push('--resume', resume);
  if (prompt) args.push(prompt.replace(/\s*\n+\s*/g, ' '));
  const tab = spawnTerminal({ title, cwd, file: exe, args });
  const t = tabs.get(tab.id);
  t.agentIds = helpers.map((a) => a.id);
  if (resume) t.sessionId = resume;
  return { ...tab, sessionId: resume || null, agents: helpers.map((a) => ({ key: a.key, name: a.name })) };
}

// Helper agents become Claude Code subagents via --agents (each with its own model and effort).
function agentsJson(helpers) {
  const out = {};
  for (const a of helpers) {
    const def = { description: a.role, prompt: a.prompt || `You are the ${a.name} on this project. ${a.role}` };
    if (a.model && a.model !== 'inherit') def.model = a.model;
    if (a.effort && a.effort !== 'inherit') def.effort = a.effort;
    out[a.key] = def;
  }
  return out;
}

function helperHint(helpers) {
  const list = helpers.map((a) => `${a.key} (${a.role})`).join('; ');
  return `Helper agents are set up for this session: ${list}. Hand matching work to them with the Agent tool `
    + 'instead of doing it all yourself, and run independent jobs in parallel.';
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'helper';

const STARTER_AGENTS = [
  { name: 'Researcher', model: 'haiku', effort: 'low',
    role: 'Finds things: searches the code, reads files and docs, and reports back a short summary. Use it for any look-up or exploration.' },
  { name: 'Coder', model: 'inherit', effort: 'high',
    role: 'Makes a well-defined code change, then checks that it builds or runs. Use it for implementation work.' },
  { name: 'Reviewer', model: 'sonnet', effort: 'medium',
    role: 'Reviews finished changes for bugs, missed edge cases and security problems, and lists what to fix. Use it before calling work done.' },
];

function spawnTerminal({ title, cwd, file, args }) {
  const id = `t${nextTab++}`;
  cwd = cwd || os.homedir();
  const p = pty.spawn(file, args, {
    name: 'xterm-256color', cols: 120, rows: 32, cwd,
    env: { ...cleanEnv(), LEMON_PORT: String(hookPort), LEMON_TAB: id, COLORTERM: 'truecolor' },
  });
  const tab = { pty: p, cwd, title, sessionId: null };
  tabs.set(id, tab);
  p.onData((d) => send('pty:data', id, d));
  p.onExit(({ exitCode }) => { tabs.delete(id); send('pty:exit', id, exitCode); });
  return { id, cwd, title };
}

// ---- git ------------------------------------------------------------------

const git = (cwd, args) => new Promise((resolve) => {
  execFile('git', args, { cwd, windowsHide: true }, (err, stdout, stderr) => resolve({ ok: !err, stdout, stderr }));
});

async function gitStatus(cwd) {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok) return { isRepo: false, files: [] };
  const st = await git(cwd, ['status', '--porcelain']);
  return { isRepo: true, files: st.stdout.split('\n').filter(Boolean) };
}

// ---- projects -------------------------------------------------------------

// A new folder named from what the user typed, with git, AGENTS.md, CLAUDE.md and the secrets hook.
async function newProjectFolder(text) {
  const name = folderName(text);
  let clean = name, dir = path.join(config.projectsRoot, clean);
  for (let n = 2; fs.existsSync(dir); n++) { clean = `${name}-${n}`; dir = path.join(config.projectsRoot, clean); }
  fs.mkdirSync(path.join(dir, '.githooks'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), AGENTS_SKELETON(clean));
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${clean}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n.env\nsecrets.yaml\n*.log\n*.db\n');
  fs.copyFileSync(path.join(ROOT, 'templates', 'githooks', 'pre-commit'), path.join(dir, '.githooks', 'pre-commit'));
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'core.hooksPath', '.githooks']);
  trustFolder(dir);
  return { dir, title: clean };
}

// Claude asks "Do you trust this folder?" for every new folder, even inside a trusted one. For the empty
// folders we just made, pre-accept it in ~/.claude.json (backed up first). Only touches that folder's entry.
function trustFolder(dir) {
  const file = path.join(os.homedir(), '.claude.json');
  if (!fs.existsSync(file)) return; // Claude never ran: leave its first-run setup alone
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.copyFileSync(file, `${file}.lemon-backup`);
    const key = dir.replace(/\\/g, '/');
    j.projects = j.projects || {};
    j.projects[key] = { ...(j.projects[key] || {}), hasTrustDialogAccepted: true };
    fs.writeFileSync(`${file}.lemon-tmp`, JSON.stringify(j, null, 2));
    fs.renameSync(`${file}.lemon-tmp`, file);
  } catch { /* unreadable or busy: Claude will just ask */ }
}

// Start button: picked templates (none = Blank) plus what the user typed, with the picked helper agents.
async function startProject(text, templateIds, agentIds) {
  const picked = config.templates.filter((t) => templateIds.includes(t.id));
  const helpers = [...new Set([...agentIds, ...picked.flatMap((t) => t.agents || [])])];
  const fixed = picked.find((t) => t.folder && fs.existsSync(t.folder));
  let cwd, title;
  if (fixed) {
    cwd = fixed.folder;
    title = String(text || '').trim().slice(0, 40) || picked.map((t) => t.name).join(' + ');
  } else {
    ({ dir: cwd, title } = await newProjectFolder(text));
  }
  return spawnClaude({ cwd, title, prompt: buildPrompt(text, picked), agentIds: helpers });
}

// ---- app ------------------------------------------------------------------

const usage = new Usage();

function iconPath() {
  const p = path.join(ROOT, 'build', 'icon.png');
  return fs.existsSync(p) ? p : undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1000, minHeight: 640,
    backgroundColor: '#111215',
    title: 'Lemon Code',
    icon: iconPath(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#16171b', symbolColor: '#c9c9cf', height: 58 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Links printed in the terminal open in the browser. Only web links: never file: or custom schemes.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('app:init', () => ({
  config,
  sessions: usage.listSessions(),
  usage: usage.summary(),
  claude: claudeExe(),
}));
ipcMain.handle('sessions:list', () => usage.listSessions());
ipcMain.handle('config:set', (_e, patch) => { config = { ...config, ...patch }; saveConfig(); return config; });

const attempt = async (fn) => { try { return { ok: true, tab: await fn() }; } catch (err) { return { ok: false, error: err.message }; } };
ipcMain.handle('project:start', (_e, { text, templateIds, agentIds }) => {
  config.lastAgents = agentIds || [];
  saveConfig();
  return attempt(() => startProject(text, templateIds || [], config.lastAgents));
});
ipcMain.handle('claude:resume', (_e, s) => attempt(() => spawnClaude({
  cwd: s.cwd, title: s.title, resume: s.id, agentIds: config.sessionAgents[s.id] || [],
})));
// No Claude Code yet (new users): run Anthropic's installer in a terminal tab.
ipcMain.handle('claude:install', () => attempt(() => spawnTerminal({
  title: 'Install Claude Code', file: 'powershell.exe',
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://claude.ai/install.ps1 | iex'],
})));

ipcMain.handle('templates:save', (_e, t) => {
  const tpl = {
    id: t.id || `tpl-${Date.now().toString(36)}`, name: String(t.name || 'Untitled').slice(0, 40),
    icon: String(t.icon || '✨').slice(0, 4), folder: t.folder || null, prompt: String(t.prompt || ''),
    agents: Array.isArray(t.agents) ? t.agents : [],
  };
  const i = config.templates.findIndex((x) => x.id === tpl.id);
  if (i >= 0) config.templates[i] = tpl; else config.templates.push(tpl);
  saveConfig();
  return config.templates;
});
ipcMain.handle('templates:delete', (_e, id) => {
  config.templates = config.templates.filter((t) => t.id !== id);
  saveConfig();
  return config.templates;
});
ipcMain.handle('agents:save', (_e, a) => {
  const id = a.id || `agent-${Date.now().toString(36)}`;
  const name = String(a.name || 'Helper').slice(0, 40);
  let key = slug(name);
  while (config.agents.some((x) => x.key === key && x.id !== id)) key += '-2';
  const agent = {
    id, key, name, role: String(a.role || '').trim() || `Helps with ${name.toLowerCase()} work.`,
    prompt: String(a.prompt || '').trim(), model: a.model || 'inherit', effort: a.effort || 'inherit',
  };
  const i = config.agents.findIndex((x) => x.id === id);
  if (i >= 0) config.agents[i] = agent; else config.agents.push(agent);
  saveConfig();
  return config.agents;
});
ipcMain.handle('agents:delete', (_e, id) => {
  config.agents = config.agents.filter((a) => a.id !== id);
  config.lastAgents = config.lastAgents.filter((x) => x !== id);
  for (const t of config.templates) if (t.agents) t.agents = t.agents.filter((x) => x !== id);
  saveConfig();
  return config;
});
ipcMain.handle('agents:starter', () => {
  for (const s of STARTER_AGENTS) {
    if (config.agents.some((a) => a.key === slug(s.name))) continue;
    config.agents.push({ id: `agent-${slug(s.name)}`, key: slug(s.name), prompt: '', ...s });
  }
  saveConfig();
  return config.agents;
});
ipcMain.handle('dialog:folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.on('pty:write', (_e, id, data) => { const t = tabs.get(id); if (t) t.pty.write(data); });
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  const t = tabs.get(id);
  if (t && cols > 1 && rows > 1) { try { t.pty.resize(cols, rows); } catch { /* exited */ } }
});
ipcMain.handle('pty:kill', (_e, id) => { const t = tabs.get(id); if (t) t.pty.kill(); });

ipcMain.handle('git:status', (_e, id) => { const t = tabs.get(id); return t ? gitStatus(t.cwd) : { isRepo: false, files: [] }; });
ipcMain.handle('complete', async (_e, { id, message }) => {
  const t = tabs.get(id);
  if (!t) return { ok: false, error: 'That session has already closed.' };
  if (message) {
    await git(t.cwd, ['add', '-A']);
    const c = await git(t.cwd, ['commit', '-q', '-m', message]);
    if (!c.ok && /Author identity unknown|Please tell me who you are/.test(c.stderr)) return { ok: false, needIdentity: true };
    if (!c.ok) return { ok: false, error: (c.stderr || c.stdout || 'git commit failed').trim() };
  }
  if (t.sessionId && !config.archived.includes(t.sessionId)) { config.archived.push(t.sessionId); saveConfig(); }
  t.pty.kill();
  return { ok: true };
});
// First commit on a PC with no git identity: the user types it once in the COMPLETE dialog.
ipcMain.handle('git:identity', async (_e, { name, email }) => {
  const a = await git(os.homedir(), ['config', '--global', 'user.name', name]);
  const b = await git(os.homedir(), ['config', '--global', 'user.email', email]);
  return a.ok && b.ok;
});
ipcMain.handle('archive:toggle', (_e, sessionId) => {
  const i = config.archived.indexOf(sessionId);
  if (i >= 0) config.archived.splice(i, 1); else config.archived.push(sessionId);
  saveConfig();
  return config.archived;
});
ipcMain.handle('open:folder', (_e, dir) => shell.openPath(dir));

app.whenReady().then(async () => {
  await startHookServer();
  writeHookSettings();
  usage.on('update', (s) => send('usage', s));
  usage.on('assistant-text', ({ session, text }) => {
    for (const [id, t] of tabs) if (t.sessionId === session) send('assistant-text', id, text);
  });
  usage.start();
  createWindow();
});

app.on('window-all-closed', () => {
  for (const t of tabs.values()) { try { t.pty.kill(); } catch { /* gone */ } }
  app.quit();
});
