// LemonCode renderer: tabs, pages (home, agents, recent, archived), terminals, chat view, token meter, Citron, modals.
(async function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const api = window.lemon;
  const boot = await api.init();
  let config = boot.config;
  let usage = boot.usage;
  let sessions = boot.sessions;

  // ---- helpers -------------------------------------------------------------
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n));
  const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');
  const ago = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  // The local one runs on this PC through Ollama (see src/router.js); the name must match LOCAL_MODEL there.
  const MODEL_NAMES = {
    inherit: 'Same as main', fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku',
    'lemon-qwen3-coder': 'Local: Qwen3 Coder',
  };
  const EFFORT_NAMES = { inherit: 'Same as main', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

  // ---- Citron --------------------------------------------------------------
  Citron.render($('brandCitron'), 'idle', 0);
  const strip = $('strip'), bubble = $('bubble'), citronCanvas = $('citron');
  const citron = Citron.animate(citronCanvas, 'idle');
  const LINES = {
    happy: ['Done! 🍋', 'All squeezed!', 'Nailed it!', 'Fresh and done!'],
    chill: ['Taking it easy 😎', 'Zest mode: off', 'Anyone need a lemon?', 'Squeezing the day', 'Just vibing'],
    idle: ['Ready when you are', 'What are we building?', 'Type something and press Enter!'],
  };
  const walker = { x: 140, dir: 1, walking: false, stepsLeft: 0, restLeft: 40 };
  let bubbleTimer = null;

  function say(text, ms = 4000, needs = false) {
    clearTimeout(bubbleTimer);
    bubble.textContent = text || '';
    bubble.classList.toggle('show', !!text);
    bubble.classList.toggle('needs', needs);
    if (text && ms) bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
  }

  const MOVING = new Set(['idle', 'chill']);
  function citronTick() {
    const w = strip.clientWidth;
    const pose = shownPose();
    if (MOVING.has(pose)) {
      if (walker.walking) {
        walker.x += walker.dir * 1.6;
        if (walker.x > w - 200) walker.dir = -1;
        if (walker.x < 70) walker.dir = 1;
        if (--walker.stepsLeft <= 0) { walker.walking = false; walker.restLeft = 60 + Math.random() * 160; }
      } else if (--walker.restLeft <= 0) {
        walker.walking = true; walker.stepsLeft = 40 + Math.random() * 140;
        if (Math.random() < 0.4) walker.dir *= -1;
      }
    } else walker.walking = false;
    citron.setFlip(walker.dir < 0);
    citron.setPose(walker.walking ? 'walk' : pose);
    citronCanvas.style.left = `${walker.x - 48}px`;
    bubble.style.left = `${walker.x}px`;
  }
  setInterval(citronTick, 50);

  // ---- terminals -----------------------------------------------------------
  const tabs = new Map(); // id -> { term, fit, el, title, cwd, state, sessionId, agents, busy }
  let active = null;
  const THEME = {
    background: '#0e0f12', foreground: '#e6e6e9', cursor: '#ffd23f', cursorAccent: '#0e0f12',
    selectionBackground: '#ffd23f40',
    black: '#1b1d22', red: '#ff6b6b', green: '#3ecf8e', yellow: '#ffd23f', blue: '#6aa8ff', magenta: '#d38cff',
    cyan: '#4fd6d0', white: '#d7d7db', brightBlack: '#5d616b', brightRed: '#ff8a8a', brightGreen: '#6ee7b0',
    brightYellow: '#ffe27a', brightBlue: '#94c0ff', brightMagenta: '#e3b0ff', brightCyan: '#86ebe6', brightWhite: '#ffffff',
  };

  function addTab({ id, cwd, title, sessionId, agents }) {
    const el = document.createElement('div');
    el.className = 'term';
    $('termWrap').appendChild(el);
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', fontSize: 14, lineHeight: 1.12,
      cursorBlink: true, scrollback: 8000, theme: THEME, allowProposedApi: true,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, url) => window.open(url)));
    term.open(el);
    term.onData((d) => api.write(id, d));
    term.onResize(({ cols, rows }) => api.resize(id, cols, rows));
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      if (e.key === 'Enter' && e.shiftKey) { api.write(id, '\x1b\r'); return false; } // newline in Claude's prompt
      if (e.key === 'Escape' && t.autoTerminal) { // denying an approval fires no hook, so treat Esc as the answer
        t.waiting.clear(); t.waitingOther = false;
        setTimeout(() => backToChat(id), 300);
      }
      if (e.ctrlKey && e.key === 'c' && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return false;
      }
      if (e.ctrlKey && e.key === 'v') {
        navigator.clipboard.readText().then((t) => {
          if (t) term.paste(t); else api.write(id, '\x16'); // no text: let Claude grab an image
        }).catch(() => api.write(id, '\x16'));
        return false;
      }
      return true;
    });
    new ResizeObserver(() => { if (el.offsetParent) { try { fit.fit(); } catch { /* hidden */ } } }).observe(el);
    const chatEl = document.createElement('div');
    chatEl.className = 'chat-tab';
    chatEl.innerHTML = '<div class="chat-empty">Starting Claude…</div>';
    $('chatLog').appendChild(chatEl);
    const t = { term, fit, el, chatEl, title, cwd, state: 'idle', sessionId: sessionId || null, toolTimer: null,
      agents: agents || [], busy: {}, mode: 'chat', autoTerminal: false, started: false, status: '', shown: 0,
      waiting: new Set(), waitingOther: false, running: new Map() };
    tabs.set(id, t);
    // Sign-in and "trust this folder?" happen in the terminal before any hook fires, so if Claude hasn't
    // started after a few seconds it's probably waiting there.
    setTimeout(() => { if (!t.started && tabs.has(id)) setMode(id, 'terminal', true); }, START_WAIT_MS);
    setState(id, 'idle', agents && agents.length ? `Starting Claude + ${agents.length} helper${agents.length > 1 ? 's' : ''}…` : 'Starting Claude…');
    show(id);
    loadChatHistory(id);
  }

  // Each session shows as chat (what you and Claude said) or as Claude's real terminal. The terminal
  // opens by itself when Claude needs an answer there (approvals, questions, sign-in) and closes again after.
  const START_WAIT_MS = 6000;
  function setMode(id, mode, auto = false) {
    const t = tabs.get(id);
    if (!t) return;
    t.mode = mode;
    t.autoTerminal = auto && mode === 'terminal';
    if (id === active) show(id);
  }
  const backToChat = (id) => { const t = tabs.get(id); if (t && t.autoTerminal) setMode(id, 'chat'); };

  // The stage shows one terminal, or a page when no terminal is active.
  let view = 'home';
  const PAGES = { home: 'welcome', agents: 'agentsView', recent: 'recentView', archive: 'archiveView' };
  function show(id) {
    active = id;
    for (const [tid, t] of tabs) { t.el.hidden = tid !== id; t.chatEl.hidden = tid !== id; }
    const t = tabs.get(id);
    for (const [v, el] of Object.entries(PAGES)) $(el).hidden = !!t || view !== v;
    $('terminals').hidden = !t;
    $('completeBtn').disabled = !t;
    if (t) {
      const isChat = t.mode === 'chat';
      $('termTitle').textContent = t.title;
      $('termCwd').textContent = t.cwd;
      $('termWrap').hidden = isChat;
      $('chat').hidden = !isChat;
      $('viewToggle').textContent = isChat ? 'Terminal' : 'Chat';
      renderHelperBadges();
      renderChatStatus();
      requestAnimationFrame(() => {
        if (isChat) { scrollChatToEnd(); chatBox.focus(); return; }
        try { t.fit.fit(); } catch { /* */ }
        t.term.focus();
      });
    }
    renderTabs();
    citronMood();
  }
  function goPage(v) {
    view = v;
    show(null);
    ({ home: renderHome, agents: renderAgents, recent: renderRecent, archive: renderArchive })[v]();
  }
  const goHome = () => goPage('home');

  // ---- chat view -------------------------------------------------------------
  const chatBox = $('chatBox');
  const BUSY = new Set(['thinking', 'typing', 'coding', 'focused']);

  // Enough Markdown for Claude's replies: code blocks, inline code, bold, headings, lists, tables, links.
  // Text is escaped before any tags are added, so nothing in a transcript can inject HTML.
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');

  function markdown(text) {
    return text.split(/```[^\n]*\n?([\s\S]*?)```/g).map((part, i) => (i % 2
      ? `<pre><code>${esc(part.replace(/\n$/, ''))}</code></pre>`
      : markdownBlocks(part))).join('');
  }
  function markdownBlocks(text) {
    const html = [];
    let open = null; // 'ul', 'ol' or 'table' while inside one
    const close = () => { if (open) html.push(`</${open}>`); open = null; };
    const enter = (tag) => { if (open !== tag) { close(); open = tag; html.push(`<${tag}>`); } };
    for (const line of text.split('\n')) {
      if (!line.trim()) continue; // blank lines between list items shouldn't restart the numbering
      const item = line.match(/^\s*(?:([-*])|\d+[.)])\s+(.*)/);
      const heading = line.match(/^#{1,4}\s+(.*)/);
      if (line.trim().startsWith('|')) {
        enter('table');
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // the |---|---| row under the header
        const cells = line.trim().replace(/^\||\|$/g, '').split('|');
        html.push(`<tr>${cells.map((c) => `<td>${inline(c.trim())}</td>`).join('')}</tr>`);
      } else if (item) {
        enter(item[1] ? 'ul' : 'ol');
        html.push(`<li>${inline(item[2])}</li>`);
      } else {
        close();
        html.push(heading ? `<h4>${inline(heading[1])}</h4>` : `<p>${inline(line)}</p>`);
      }
    }
    close();
    return html.join('');
  }

  const bubbleHtml = (m) => {
    if (m.role === 'note') return `<div class="msg note">${esc(m.text)}</div>`;
    if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
    return `<div class="msg assistant${m.ask ? ' question' : ''}">${markdown(m.text)}</div>`;
  };

  const chatAtEnd = () => { const log = $('chatLog'); return log.scrollHeight - log.scrollTop - log.clientHeight < 80; };
  const scrollChatToEnd = () => { const log = $('chatLog'); log.scrollTop = log.scrollHeight; };

  // Messages carry their position in the tab's list (start), so a push that overlaps the history fetched
  // on opening is skipped instead of shown twice. reset = a new transcript (e.g. after /clear).
  function addChat(id, messages, start, reset) {
    const t = tabs.get(id);
    if (!t) return;
    const follow = id !== active || !t.shown || chatAtEnd(); // don't yank you down while you scroll back
    if (reset) t.shown = 0;
    if (!t.shown) t.chatEl.innerHTML = '';
    const fresh = messages.slice(Math.max(0, t.shown - start));
    if (start > t.shown || !fresh.length) return;
    t.chatEl.insertAdjacentHTML('beforeend', fresh.map(bubbleHtml).join(''));
    t.shown = start + messages.length;
    if (id === active && follow) scrollChatToEnd();
  }
  api.onChat(addChat);
  const loadChatHistory = (id) => api.chatHistory(id).then((messages) => { if (messages.length) addChat(id, messages, 0, false); });

  const isWaiting = (t) => t.waiting.size > 0 || t.waitingOther;
  function renderChatStatus() {
    const t = tabs.get(active);
    if (t && isWaiting(t)) {
      $('chatStatus').hidden = false;
      $('chatStatus').innerHTML = '<span class="waiting">Claude is waiting for you in the terminal.</span>'
        + '<button class="linkish" data-terminal="1">Open terminal</button>';
      return;
    }
    const busy = !!t && BUSY.has(t.state);
    $('chatStatus').hidden = !busy;
    $('chatStatus').innerHTML = busy ? `<span class="dots"><i></i><i></i><i></i></span>${esc(t.status || 'Thinking…')}` : '';
  }
  $('chatStatus').onclick = (e) => { if (e.target.closest('[data-terminal]')) setMode(active, 'terminal'); };

  function sendChat() {
    const text = chatBox.value.trim();
    const t = tabs.get(active);
    if (!t || !text) return;
    // Enter would land in the open approval dialog and pick its default answer.
    if (isWaiting(t)) { renderChatStatus(); say('Answer Claude in the terminal first', 3000, true); return; }
    api.sendChat(active, text);
    chatBox.value = '';
    fitChatBox();
  }
  const fitChatBox = () => { chatBox.style.height = 'auto'; chatBox.style.height = `${chatBox.scrollHeight}px`; };
  chatBox.oninput = fitChatBox;
  chatBox.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    if (e.key === 'Escape' && active) api.write(active, '\x1b'); // same as Esc in the terminal: stops Claude
  };
  // An image on the clipboard goes to Claude the way the terminal does it: a raw Ctrl+V lets Claude grab it.
  chatBox.onpaste = (e) => {
    const hasImage = [...e.clipboardData.items].some((i) => i.type.startsWith('image/'));
    if (!active || !hasImage || e.clipboardData.getData('text')) return;
    e.preventDefault();
    api.write(active, '\x16');
    say('Image added to your next message', 3000);
  };
  $('chatGo').onclick = sendChat;
  // Going back to chat by hand means you've dealt with the terminal. It also gets you out after denying an
  // approval, which fires no hook to say it's over.
  $('viewToggle').onclick = () => {
    const t = tabs.get(active);
    if (!t) return;
    if (t.mode === 'chat') return setMode(active, 'terminal');
    t.waiting.clear();
    t.waitingOther = false;
    setMode(active, 'chat');
  };

  api.onData((id, d) => { const t = tabs.get(id); if (t) t.term.write(d); });
  api.onExit((id) => {
    const t = tabs.get(id);
    if (!t) return;
    t.term.dispose(); t.el.remove(); t.chatEl.remove(); tabs.delete(id);
    if (active === id) { const next = [...tabs.keys()].pop(); next ? show(next) : goHome(); }
    renderTabs();
    refreshSessions();
  });
  api.onFocusTab((id) => { if (tabs.has(id)) show(id); });

  async function launch(promise) {
    const r = await promise;
    if (r && r.ok) { addTab(r.tab); return true; }
    say(clip((r && r.error) || "That didn't start", 80), 7000, true);
    return false;
  }

  // ---- tab bar + menu --------------------------------------------------------
  function renderTabs() {
    $('homeTab').classList.toggle('active', !active && view === 'home');
    $('tabs').innerHTML = [...tabs].map(([id, t]) => {
      const busy = Object.values(t.busy).reduce((s, n) => s + n, 0);
      return `<button class="tab ${id === active ? 'active' : ''}" data-id="${id}" title="${esc(t.cwd)}">`
        + `<span class="dot ${t.state}"></span><span class="t">${esc(t.title)}</span>`
        + `${busy ? `<span class="n">${busy} helper${busy > 1 ? 's' : ''}</span>` : ''}</button>`;
    }).join('');
  }
  $('tabs').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) show(b.dataset.id); };
  $('homeTab').onclick = () => { picked.clear(); goHome(); askBox.focus(); };
  $('menuBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  $('menu').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) { $('menu').hidden = true; goPage(b.dataset.view); } };
  document.addEventListener('click', (e) => { if (!e.target.closest('.menu-wrap')) $('menu').hidden = true; });

  // ---- mood machine --------------------------------------------------------
  // States per tab; Citron shows the active tab, unless another tab needs you.
  function setState(id, state, text, ms) {
    const t = tabs.get(id);
    if (!t) return;
    t.state = state; t.since = Date.now();
    if (text !== undefined) t.status = text;
    clearTimeout(t.toolTimer);
    if (id === active) renderChatStatus();
    if (id === active || state === 'needs') {
      const label = state === 'needs' && id !== active ? `${text} (${t.title})` : text;
      if (text !== undefined) say(label, ms ?? (state === 'needs' ? 0 : 4500), state === 'needs');
    }
    renderTabs();
    citronMood();
  }

  let celebrateUntil = 0;
  function shownPose() {
    if (Date.now() < celebrateUntil) return 'happy';
    for (const t of tabs.values()) if (t.state === 'needs') return 'needs';
    const t = tabs.get(active);
    if (!t) return idleSince() > 60000 ? 'chill' : 'idle';
    if (t.state === 'idle' && Date.now() - t.since > 60000) return 'chill';
    return t.state;
  }
  let lastActivity = Date.now();
  const idleSince = () => Date.now() - lastActivity;

  function citronMood() {
    const pose = shownPose();
    $('stripStatus').textContent = `Citron · ${pose === 'needs' ? 'needs you' : pose}`;
  }
  setInterval(() => {
    citronMood();
    const pose = shownPose();
    if ((pose === 'chill' || pose === 'idle') && !bubble.classList.contains('show') && Math.random() < 0.04) {
      say(pick(LINES[pose]), 3500);
    }
  }, 5000);

  const helperName = (t, key) => {
    const a = (t.agents || []).find((x) => x.key === key) || config.agents.find((x) => x.key === key);
    return a ? a.name : key ? key.replace(/[-_]/g, ' ') : 'a helper';
  };

  function describeTool(tool, input, t) {
    input = input || {};
    if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return `Editing ${base(input.file_path || input.notebook_path)}`;
    if (tool === 'Read') return `Reading ${base(input.file_path)}`;
    if (tool === 'Bash' || tool === 'PowerShell') return `Running: ${clip(input.description || input.command || '', 40)}`;
    if (tool === 'Grep' || tool === 'Glob') return `Searching for ${clip(input.pattern || '', 30)}`;
    if (tool === 'WebFetch' || tool === 'WebSearch') return 'Browsing the web';
    if (tool === 'Task' || tool === 'Agent') return `Sending ${helperName(t, input.subagent_type)}: ${clip(input.description || '', 34)}`;
    if (tool === 'TodoWrite' || /update_plan/.test(tool)) return 'Planning';
    if (tool === 'Skill') return `Using the ${input.skill || ''} skill`;
    if (tool === 'AskUserQuestion') return 'Got a question for you';
    if (/home-assistant/.test(tool)) return 'Talking to Home Assistant';
    if (/Browser|chrome/.test(tool)) return 'Using the browser';
    return clip(tool.replace(/^mcp__[^_]+__/, ''), 32);
  }

  // Helpers at work: counted per agent while running, shown on the tab and the terminal header.
  function renderHelperBadges() {
    const t = tabs.get(active);
    $('termHelpers').innerHTML = t ? (t.agents || []).map((a) =>
      `<span class="badge ${t.busy[a.key] ? 'busy' : ''}" title="${t.busy[a.key] ? 'working' : 'idle'}">${esc(a.name)}${t.busy[a.key] ? ' ●' : ''}</span>`).join('') : '';
  }
  function helperBusy(t, key, delta) {
    t.busy[key] = Math.max(0, (t.busy[key] || 0) + delta);
    if (!t.busy[key]) delete t.busy[key];
    renderTabs();
    renderHelperBadges();
  }

  api.onHook((ev) => {
    const t = tabs.get(ev.tab);
    if (!t) return;
    lastActivity = Date.now();
    if (ev.session && ev.event === 'SessionStart') t.sessionId = ev.session;
    switch (ev.event) {
      case 'SessionStart': setState(ev.tab, 'idle', 'Ready!'); break;
      case 'UserPromptSubmit': setState(ev.tab, 'thinking', 'Hmm…'); break;
      case 'PreToolUse': {
        if (ev.tool === 'AskUserQuestion') { setState(ev.tab, 'needs', 'Got a question for you!'); break; }
        if (ev.tool === 'SubagentHandback' || ev.tool === 'SendFeedback') break; // internal helper plumbing
        if ((ev.tool === 'Agent' || ev.tool === 'Task') && ev.input) helperBusy(t, ev.input.subagent_type || 'general', +1);
        const what = describeTool(ev.tool, ev.input, t);
        setState(ev.tab, 'coding', ev.agentType ? `${helperName(t, ev.agentType)}: ${what}` : what, 0);
        t.toolTimer = setTimeout(() => { if (t.state === 'coding') { t.state = 'focused'; citronMood(); } }, 9000);
        break;
      }
      case 'PostToolUse': if (t.state !== 'focused' || !Object.keys(t.busy).length) setState(ev.tab, 'thinking', ''); break;
      case 'PermissionRequest': setState(ev.tab, 'needs', `Need you! Allow ${ev.tool || 'this'}?`); break;
      case 'Notification':
        if (ev.kind === 'idle_prompt') break;
        setState(ev.tab, 'needs', clip(ev.message || 'Need you!', 60));
        break;
      case 'SubagentStop': {
        const key = ev.agentType || 'general';
        if (!t.busy[key]) break; // not one we saw start (internal subagents fire this too)
        helperBusy(t, key, -1);
        if (ev.tab === active) say(`${helperName(t, key)} finished`, 3000);
        break;
      }
      case 'Stop':
        // Helpers run in the background, so Claude's turn can end before they report back.
        if (Object.keys(t.busy).length) { setState(ev.tab, 'focused', 'Waiting for helpers…', 0); break; }
        setState(ev.tab, 'happy', pick(LINES.happy));
        setTimeout(() => { if (t.state === 'happy') setState(ev.tab, 'idle'); }, 5000);
        break;
      case 'SessionEnd': setState(ev.tab, 'idle', 'Bye!'); break;
    }
    openTerminalWhenNeeded(ev, t);
  });

  // Approvals and questions are answered in Claude's terminal, so show it until every open one is answered.
  // They're tracked by tool call id: a parallel tool or a helper can finish while a prompt is still open.
  // Other notifications (no tool call) wait for the turn to move on.
  function openTerminalWhenNeeded(ev, t) {
    if (ev.event === 'SessionStart') { t.started = true; backToChat(ev.tab); return; }
    if (ev.event === 'PreToolUse' && ev.toolUseId) t.running.set(ev.toolUseId, `${ev.tool} ${JSON.stringify(ev.input)}`);
    const toolAsks = ev.event === 'PermissionRequest' || (ev.event === 'PreToolUse' && ev.tool === 'AskUserQuestion');
    // permission_prompt repeats a PermissionRequest and can arrive after it was answered.
    const otherAsks = ev.event === 'Notification' && ev.kind !== 'idle_prompt' && ev.kind !== 'permission_prompt';
    if (toolAsks || otherAsks) {
      if (toolAsks) t.waiting.add(ev.toolUseId || askedToolId(t, ev) || ev.tool); else t.waitingOther = true;
      if (t.mode === 'chat') setMode(ev.tab, 'terminal', true);
      if (ev.tab === active) renderChatStatus();
      return;
    }
    if (ev.event === 'PostToolUse') {
      t.running.delete(ev.toolUseId);
      t.waiting.delete(ev.toolUseId);
      t.waiting.delete(ev.tool); // when the request couldn't be matched to a call
      t.waitingOther = false;
    }
    // A denied tool has no PostToolUse, so a finished or new turn clears everything.
    if (ev.event === 'Stop' || ev.event === 'UserPromptSubmit') { t.waiting.clear(); t.running.clear(); t.waitingOther = false; }
    if (!isWaiting(t)) backToChat(ev.tab);
    if (ev.tab === active) renderChatStatus();
  }
  // PermissionRequest has no tool_use_id (seen in testing), but it has the tool and its input: find the
  // running call with the same ones.
  function askedToolId(t, ev) {
    const wanted = `${ev.tool} ${JSON.stringify(ev.input)}`;
    for (const [id, call] of t.running) if (call === wanted && !t.waiting.has(id)) return id;
    return null;
  }

  api.onAssistantText((id) => {
    const t = tabs.get(id);
    if (!t || t.state === 'needs' || t.state === 'happy') return;
    const prev = t.state;
    setState(id, 'typing');
    setTimeout(() => { if (t.state === 'typing') setState(id, prev === 'typing' ? 'thinking' : prev); }, 3000);
  });

  // ---- home: type box, helpers, templates ------------------------------------
  // No template picked = Blank: a new folder named from what you type, and your words as the first prompt.
  const picked = new Set();
  const pickedAgents = new Set(config.lastAgents.filter((id) => config.agents.some((a) => a.id === id)));
  const askBox = $('askBox');

  function renderHome() {
    $('setupCard').hidden = !!boot.claude;
    const tpl = config.templates;
    const card = (t) => `<button class="card ${picked.has(t.id) ? 'on' : ''}" data-k="${t.id}"><span class="tick"></span>`
      + `<span class="big">${esc(t.icon || '✨')}</span><strong>${esc(t.name)}</strong>`
      + `<small>${t.folder ? esc(base(t.folder)) : 'New folder each time'}</small>`
      + `<span class="edit" data-edit="${t.id}">✎ Edit</span></button>`;
    $('tplCards').innerHTML =
      `<button class="card ${picked.size ? '' : 'on'}" data-k=""><span class="tick"></span><span class="big">💬</span><strong>Blank</strong><small>Just open a chat</small></button>`
      + tpl.map(card).join('')
      + '<button class="card add" data-add="1"><span class="big">＋</span><strong>New template</strong><small>Save a starting prompt and folder</small></button>';
    const chosen = tpl.filter((t) => picked.has(t.id));
    $('tplToggle').textContent = `Templates ${$('tplCards').hidden ? '▸' : '▾'}${chosen.length ? ` · ${chosen.map((t) => t.name).join(' + ')}` : ''}`;
    const fixed = chosen.find((t) => t.folder);
    $('askWhere').textContent = fixed
      ? `Opens in ${fixed.folder}`
      : `Opens in a new folder in ${config.projectsRoot}, named from what you type`;
    const fromTemplates = new Set(chosen.flatMap((t) => t.agents || []));
    $('helpers').innerHTML = config.agents.length
      ? '<span class="label">Helpers</span>' + config.agents.map((a) => {
        const on = pickedAgents.has(a.id) || fromTemplates.has(a.id);
        return `<button class="hchip ${on ? 'on' : ''}" data-agent="${a.id}" title="${esc(a.role)}">${esc(a.name)} <small>${esc(MODEL_NAMES[a.model] === 'Same as main' ? '' : MODEL_NAMES[a.model] || '')}</small></button>`;
      }).join('') + '<button class="linkish" data-manage="1">Manage</button>'
      : '<button class="linkish" data-manage="1">＋ Add helper agents (each with its own role, model and effort)</button>';
  }

  $('tplToggle').onclick = () => { $('tplCards').hidden = !$('tplCards').hidden; renderHome(); };
  $('helpers').onclick = (e) => {
    if (e.target.closest('[data-manage]')) return goPage('agents');
    const b = e.target.closest('[data-agent]');
    if (!b) return;
    const id = b.dataset.agent;
    pickedAgents.has(id) ? pickedAgents.delete(id) : pickedAgents.add(id);
    renderHome();
    askBox.focus();
  };
  $('tplCards').onclick = (e) => {
    const edit = e.target.closest('[data-edit]');
    if (edit) { e.stopPropagation(); return templateModal(config.templates.find((t) => t.id === edit.dataset.edit)); }
    if (e.target.closest('[data-add]')) return templateModal(null);
    const b = e.target.closest('[data-k]');
    if (!b) return;
    const k = b.dataset.k;
    if (!k) picked.clear(); else if (picked.has(k)) picked.delete(k); else picked.add(k);
    renderHome();
    askBox.focus();
  };

  async function startProject() {
    const text = askBox.value.trim();
    $('askGo').disabled = true;
    const ok = await launch(api.startProject(text, [...picked], [...pickedAgents]));
    $('askGo').disabled = false;
    if (ok) {
      config.lastAgents = [...pickedAgents];
      askBox.value = ''; fitAsk(); picked.clear(); $('tplCards').hidden = true; renderHome();
      say("Let's get to work!", 3500);
    }
  }
  const fitAsk = () => { askBox.style.height = 'auto'; askBox.style.height = `${askBox.scrollHeight}px`; };
  askBox.oninput = fitAsk;
  askBox.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); startProject(); } };
  $('askGo').onclick = startProject;
  $('installBtn').onclick = () => launch(api.installClaude());

  // ---- agents page -----------------------------------------------------------
  function renderAgents() {
    $('agentList').innerHTML = config.agents.map((a) => `<div class="arow"><span class="meta">`
      + `<span class="t">${esc(a.name)}</span><span class="s">${esc(a.role)}</span>`
      + `<span class="badges"><span class="badge">${esc(MODEL_NAMES[a.model] || a.model)}</span><span class="badge">Effort: ${esc(EFFORT_NAMES[a.effort] || a.effort)}</span></span></span>`
      + `<button data-edit-agent="${a.id}">Edit</button></div>`).join('')
      || `<div class="arow"><span class="meta"><span class="t">No helpers yet</span><span class="s">Start with a Researcher (Haiku, low effort), a Coder (same model as main, high effort) and a Reviewer (Sonnet, medium), then change them as you like.</span></span><button id="starterBtn">Add starter team</button></div>`;
    const starter = $('starterBtn');
    if (starter) starter.onclick = async () => { config.agents = await api.addStarterAgents(); renderAgents(); say('Say hi to the team!', 3000); };
  }
  $('agentList').onclick = (e) => {
    const b = e.target.closest('[data-edit-agent]');
    if (b) agentModal(config.agents.find((a) => a.id === b.dataset.editAgent));
  };
  $('newAgentBtn').onclick = () => agentModal(null);

  // ---- recent + archived pages ---------------------------------------------
  // Recent: every Claude Code session except running and archived ones. Archived only show in their own page.
  const sessionRow = (s, buttons) => `<div class="arow"><span class="meta"><span class="t">${esc(s.title)}</span>`
    + `<span class="s">${esc(s.cwd)} · ${ago(s.mtime)}</span></span>${buttons}</div>`;
  function renderRecent() {
    const live = new Set([...tabs.values()].map((t) => t.sessionId).filter(Boolean));
    const archived = new Set(config.archived);
    const rows = sessions.filter((s) => !archived.has(s.id) && !live.has(s.id)).slice(0, 30);
    $('recentList').innerHTML = rows.map((s) => sessionRow(s, `<button data-open="${s.id}">Reopen</button><button data-toggle="${s.id}">Archive</button>`)).join('')
      || '<div class="empty">No sessions yet.</div>';
  }
  function renderArchive() {
    const archived = new Set(config.archived);
    const rows = sessions.filter((s) => archived.has(s.id));
    $('archiveList').innerHTML = rows.map((s) => sessionRow(s, `<button data-open="${s.id}">Reopen</button><button data-toggle="${s.id}">Move to Recent</button>`)).join('')
      || '<div class="empty">Nothing archived yet. Press COMPLETE when a project is finished.</div>';
  }
  function renderCounts() {
    const archived = new Set(config.archived);
    const n = sessions.filter((s) => archived.has(s.id)).length;
    $('archiveCount').textContent = n ? `(${n})` : '';
    if (!active && view === 'recent') renderRecent();
    if (!active && view === 'archive') renderArchive();
  }
  async function refreshSessions() { sessions = await api.listSessions(); renderCounts(); }
  function resumeSession(sid) {
    const s = sessions.find((x) => x.id === sid);
    if (!s) return;
    for (const [id, t] of tabs) if (t.sessionId === s.id) return show(id);
    launch(api.resume(s));
  }
  function onSessionRows(e) {
    const tg = e.target.closest('[data-toggle]');
    if (tg) return api.toggleArchive(tg.dataset.toggle).then((a) => { config.archived = a; renderCounts(); });
    const o = e.target.closest('[data-open]');
    if (o) resumeSession(o.dataset.open);
  }
  $('recentList').onclick = onSessionRows;
  $('archiveList').onclick = onSessionRows;
  setInterval(refreshSessions, 30000);

  $('openFolderBtn').onclick = () => { const t = tabs.get(active); if (t) api.openFolder(t.cwd); };
  $('closeTabBtn').onclick = () => { if (active) api.kill(active); };

  // ---- pickers (main Claude, new sessions) -----------------------------------
  // Model and effort each have a slider; the arm shows both as one strength. Dragging only previews;
  // the change is saved when you let go.
  const modelPick = $('modelPick'), effortPick = $('effortPick');
  function showPicks() {
    const modelIndex = Number(modelPick.value), effortIndex = Number(effortPick.value);
    const strength = (modelIndex / (boot.models.length - 1) + effortIndex / (boot.efforts.length - 1)) / 2;
    $('powerArm').innerHTML = Arm.svg(Math.round(strength * 5));
    $('modelName').textContent = MODEL_NAMES[boot.models[modelIndex]];
    $('effortName').textContent = EFFORT_NAMES[boot.efforts[effortIndex]];
  }
  modelPick.value = boot.models.indexOf(config.model);
  effortPick.value = boot.efforts.indexOf(config.effort);
  showPicks();
  modelPick.oninput = showPicks;
  effortPick.oninput = showPicks;
  modelPick.onchange = async () => {
    const model = boot.models[Number(modelPick.value)];
    config = await api.setConfig({ model });
    say(`New sessions use ${MODEL_NAMES[model]}`, 3000);
  };
  effortPick.onchange = async () => {
    const effort = boot.efforts[Number(effortPick.value)];
    config = await api.setConfig({ effort });
    say(`New sessions use ${EFFORT_NAMES[effort]} effort`, 3000);
  };

  $('modePick').value = config.mode || 'default';
  $('modePick').onchange = async (e) => { config = await api.setConfig({ mode: e.target.value }); say('New sessions use that mode', 3000); };

  // ---- token meter ---------------------------------------------------------
  const budget = () => config.dailyBudget || usage.avg14active || 0;
  const warned = { day: null, 80: false, 100: false };

  function renderMeter() {
    const b = budget();
    const today = usage.today.main;
    const pct = b ? today / b : 0;
    $('meterToday').textContent = fmt(today);
    $('meterOf').textContent = b ? `of ${fmt(b)} · ${Math.round(pct * 100)}%` : 'no budget yet';
    const fill = $('meterFill');
    fill.style.width = `${Math.min(100, pct * 100)}%`;
    fill.className = 'meter-fill' + (pct >= 1 ? ' red' : pct >= 0.8 ? ' amber' : '');
    const w = usage.window;
    $('meterWindow').textContent = w ? `5h window: ${fmt(w.main)} · resets in ${until(w.end)}` : '5h window not started';

    const day = new Date().toDateString();
    if (warned.day !== day) Object.assign(warned, { day, 80: pct >= 0.8, 100: pct >= 1 }); // don't nag at startup
    if (b && pct >= 1 && !warned[100]) { warned[100] = true; say(`Over today's budget (${fmt(b)})!`, 8000, true); }
    else if (b && pct >= 0.8 && !warned[80]) { warned[80] = true; say("80% of today's budget used", 7000); }
    if (!$('meterPop').hidden) renderPop();
  }
  const until = (t) => {
    const m = Math.max(0, Math.round((t - Date.now()) / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
  };

  function renderPop() {
    const b = budget(), u = usage, w = u.window;
    const days = [...u.history, { day: 'today', main: u.today.main }];
    const max = Math.max(b, ...days.map((d) => d.main), 1);
    const sessionTokens = (() => { const t = tabs.get(active); return t && t.sessionId ? u.sessions[t.sessionId] || 0 : null; })();
    const projColour = b && u.projection > b ? 'var(--red)' : 'var(--text)';
    $('meterPop').innerHTML = `
      <div class="pop-big">${fmt(u.today.main)}<small>${b ? `of ${fmt(b)} today` : 'today'}</small></div>
      <div class="pop-sub">+ ${fmt(u.today.cacheRead)} cache reads (cheap, not counted) · in ${fmt(u.today.input)} · out ${fmt(u.today.output)} · cache writes ${fmt(u.today.cacheWrite)}</div>
      <div class="pop-grid">
        <div class="pop-stat"><b>${w ? until(w.end) : '–'}</b><span>${w ? `until the 5h window resets · ${fmt(w.main)} used` : '5h window not started'}</span></div>
        <div class="pop-stat"><b style="color:${projColour}">${fmt(u.projection)}</b><span>today at this pace</span></div>
        <div class="pop-stat"><b>${fmt(u.avg7)}</b><span>7-day average</span></div>
        <div class="pop-stat"><b>${sessionTokens === null ? '–' : fmt(sessionTokens)}</b><span>this session</span></div>
      </div>
      <div class="bars">${days.map((d) => `<div class="b ${d.day === 'today' ? 'today' : ''} ${b && d.main > b ? 'over' : ''}" style="height:${(d.main / max) * 100}%" title="${d.day}: ${fmt(d.main)}"></div>`).join('')}
        ${b ? `<div class="budget-line" style="bottom:${(b / max) * 100}%"></div>` : ''}</div>
      <div class="bar-labels">${days.map((d) => `<span>${d.day === 'today' ? 'today' : new Date(d.day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short' })}</span>`).join('')}</div>
      <div class="pop-budget"><input id="budgetInput" type="text" placeholder="Daily budget, e.g. 2M or 1500k" value="${config.dailyBudget ? fmt(config.dailyBudget) : ''}"><button class="btn primary" id="budgetSave">Save</button></div>
      <div class="pop-note">${config.dailyBudget ? 'Clear the box to go back to your 14-day average.' : `Using your 14-day average (${fmt(u.avg14active)}) until you set one.`} Counts input + output + cache writes across all Claude Code sessions (helpers included), desktop app too.</div>`;
    $('budgetSave').onclick = saveBudget;
    $('budgetInput').onkeydown = (e) => { if (e.key === 'Enter') saveBudget(); };
  }
  async function saveBudget() {
    const raw = $('budgetInput').value.trim().toLowerCase();
    let n = null;
    if (raw) {
      const m = raw.match(/^([\d.]+)\s*([km]?)$/);
      if (!m) { $('budgetInput').style.borderColor = 'var(--red)'; return; }
      n = Math.round(parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1));
    }
    config = await api.setConfig({ dailyBudget: n });
    renderMeter(); renderPop();
    say(n ? `Budget set: ${fmt(n)} a day` : 'Back to your 14-day average', 3000);
  }
  $('meterBtn').onclick = (e) => { e.stopPropagation(); $('meterPop').hidden = !$('meterPop').hidden; if (!$('meterPop').hidden) renderPop(); };
  document.addEventListener('click', (e) => { if (!e.target.closest('#meterPop') && !e.target.closest('#meterBtn')) $('meterPop').hidden = true; });
  api.onUsage((u) => { usage = u; renderMeter(); });
  setInterval(renderMeter, 30000);
  renderMeter();

  // ---- modals --------------------------------------------------------------
  function openModal(html) { $('modal').innerHTML = html; $('modalBack').hidden = false; }
  function closeModal() { $('modalBack').hidden = true; $('modal').innerHTML = ''; }
  $('modalBack').onclick = (e) => { if (e.target === $('modalBack')) closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalBack').hidden) closeModal(); });
  const options = (names, value) => Object.entries(names).map(([v, label]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${label}</option>`).join('');

  // Make or edit a helper agent: name, role (when Claude should use it), model, effort, optional instructions.
  function agentModal(a) {
    openModal(`
      <h2>${a ? 'Edit agent' : 'New agent'}</h2>
      <p>A helper your main Claude can hand work to. It runs with its own model and effort.</p>
      <label class="f">Name</label>
      <input type="text" id="aName" placeholder="e.g. Tester" value="${esc(a ? a.name : '')}">
      <label class="f">Role: what it does and when to use it</label>
      <textarea id="aRole" style="min-height:70px" placeholder="e.g. Writes and runs tests for new code, and reports failures.">${esc(a ? a.role : '')}</textarea>
      <div class="two" style="margin-top:4px">
        <div style="flex:1"><label class="f">Model</label><select id="aModel">${options(MODEL_NAMES, a ? a.model : 'inherit')}</select></div>
        <div style="flex:1"><label class="f">Effort</label><select id="aEffort">${options(EFFORT_NAMES, a ? a.effort : 'inherit')}</select></div>
      </div>
      <label class="f">Extra instructions (optional)</label>
      <textarea id="aPrompt" style="min-height:80px" placeholder="Anything else it should always do, e.g. 'Keep reports under 10 lines.'">${esc(a ? a.prompt : '')}</textarea>
      <div class="err" id="aErr"></div>
      <div class="row">${a ? '<button class="btn danger" id="aDelete">Delete</button>' : ''}<button class="btn" id="aCancel">Cancel</button><button class="btn primary" id="aSave">Save agent</button></div>`);
    $('aName').focus();
    $('aCancel').onclick = closeModal;
    if (a) $('aDelete').onclick = async () => {
      config = await api.deleteAgent(a.id);
      pickedAgents.delete(a.id);
      closeModal(); renderAgents(); renderHome();
    };
    $('aSave').onclick = async () => {
      const name = $('aName').value.trim(), role = $('aRole').value.trim();
      if (!name) { $('aErr').textContent = 'Give it a name.'; return; }
      if (!role) { $('aErr').textContent = 'Say what it does, so Claude knows when to use it.'; return; }
      config.agents = await api.saveAgent({ id: a && a.id, name, role, model: $('aModel').value, effort: $('aEffort').value, prompt: $('aPrompt').value });
      if (!a) pickedAgents.add(config.agents[config.agents.length - 1].id);
      closeModal(); renderAgents(); renderHome(); say(`${name} joined the team`, 3000);
    };
  }

  // Make or edit a template: name, icon, where it opens, its helpers, and the prompt it starts with.
  function templateModal(t) {
    let folder = t ? t.folder : null;
    const tAgents = new Set(t ? t.agents || [] : []);
    openModal(`
      <h2>${t ? 'Edit template' : 'New template'}</h2>
      <p>Pick it on the home page, type what you want (or nothing), press Enter.</p>
      <label class="f">Name and icon</label>
      <div class="two"><input type="text" class="icon" id="tIcon" value="${esc(t ? t.icon : '✨')}"><input type="text" id="tName" placeholder="e.g. Website fix" value="${esc(t ? t.name : '')}"></div>
      <label class="f">Opens in</label>
      <div class="radio">
        <label><input type="radio" name="tWhere" value="new" ${folder ? '' : 'checked'}> A new project folder each time</label>
        <label><input type="radio" name="tWhere" value="fixed" ${folder ? 'checked' : ''}> Always the same folder</label>
      </div>
      <div class="folder-row" id="tFolderRow" ${folder ? '' : 'hidden'}><div class="path" id="tFolder">${esc(folder || 'No folder picked')}</div><button class="btn" id="tBrowse">Browse…</button></div>
      ${config.agents.length ? `<label class="f">Helpers it brings</label><div class="checks">${config.agents.map((a) =>
        `<label><input type="checkbox" class="tAgent" value="${a.id}" ${tAgents.has(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div>` : ''}
      <label class="f">Starting prompt (sent before whatever you type)</label>
      <textarea id="tPrompt" placeholder="e.g. You're working on my website. Ask me questions before changing anything.">${esc(t ? t.prompt : '')}</textarea>
      <div class="err" id="tErr"></div>
      <div class="row">${t ? '<button class="btn danger" id="tDelete">Delete</button>' : ''}<button class="btn" id="tCancel">Cancel</button><button class="btn primary" id="tSave">Save template</button></div>`);
    $('tName').focus();
    const where = () => document.querySelector('input[name=tWhere]:checked').value;
    document.querySelectorAll('input[name=tWhere]').forEach((r) => { r.onchange = () => { $('tFolderRow').hidden = where() !== 'fixed'; }; });
    $('tBrowse').onclick = async () => { const p = await api.pickFolder(); if (p) { folder = p; $('tFolder').textContent = p; } };
    $('tCancel').onclick = closeModal;
    if (t) $('tDelete').onclick = async () => { config.templates = await api.deleteTemplate(t.id); picked.delete(t.id); closeModal(); renderHome(); };
    $('tSave').onclick = async () => {
      const name = $('tName').value.trim();
      if (!name) { $('tErr').textContent = 'Give it a name.'; return; }
      if (where() === 'fixed' && !folder) { $('tErr').textContent = 'Pick the folder, or choose "a new project folder".'; return; }
      config.templates = await api.saveTemplate({
        id: t && t.id, name, icon: $('tIcon').value.trim(), prompt: $('tPrompt').value,
        folder: where() === 'fixed' ? folder : null,
        agents: [...document.querySelectorAll('.tAgent:checked')].map((c) => c.value),
      });
      closeModal(); renderHome(); say(`Template saved: ${name}`, 3000);
    };
  }

  async function complete() {
    const id = active, t = tabs.get(id);
    if (!t) return;
    const st = await api.gitStatus(id);
    const dirty = st.isRepo && st.files.length > 0;
    openModal(`
      <h2>Is that all?</h2>
      <p><strong>${esc(t.title)}</strong> will close and move to Archived projects. You can reopen it from there.</p>
      ${dirty ? `<div class="files">${st.files.slice(0, 40).map(esc).join('\n')}${st.files.length > 40 ? `\n…and ${st.files.length - 40} more` : ''}</div>
        <input type="text" id="commitMsg" placeholder="Commit message (short, plain)">` : `<p>${st.isRepo ? 'No uncommitted changes.' : 'Not a git folder, so nothing to commit.'}</p>`}
      <div class="err" id="doneErr"></div>
      <div class="row">
        <button class="btn" id="doneCancel">Not yet</button>
        ${dirty ? '<button class="btn" id="doneNoCommit">Complete without commit</button><button class="btn go" id="doneCommit">Commit &amp; complete</button>'
                : '<button class="btn go" id="doneGo">Complete</button>'}
      </div>`);
    $('doneCancel').onclick = closeModal;
    const finish = async (message) => {
      const r = await api.complete(id, message);
      if (r.needIdentity) return askIdentity(() => finish(message));
      if (!r.ok) { $('doneErr').textContent = r.error; return; }
      closeModal();
      const sid = t.sessionId;
      if (sid && !config.archived.includes(sid)) config.archived.push(sid);
      celebrateUntil = Date.now() + 5000; // the tab closes, so celebrate on the strip itself
      say(message ? 'Committed and done! 🍋' : pick(LINES.happy), 5000);
    };
    if (dirty) {
      $('commitMsg').focus();
      $('doneCommit').onclick = () => {
        const m = $('commitMsg').value.trim();
        if (!m) { $('commitMsg').style.borderColor = 'var(--red)'; $('commitMsg').focus(); return; }
        finish(m);
      };
      $('commitMsg').onkeydown = (e) => { if (e.key === 'Enter') $('doneCommit').click(); };
      $('doneNoCommit').onclick = () => finish(null);
    } else $('doneGo').onclick = () => finish(null);
  }
  $('completeBtn').onclick = complete;

  // Git won't commit without a name and email; ask once, save globally, then retry.
  function askIdentity(retry) {
    $('doneErr').style.whiteSpace = 'normal';
    $('doneErr').innerHTML = '<p style="color:var(--text);margin:8px 0 6px">Git needs your name and email once (shown on your commits).</p>'
      + '<div class="two"><input type="text" id="gitName" placeholder="Name"><input type="text" id="gitEmail" placeholder="Email"></div>'
      + '<div class="row"><button class="btn go" id="gitSave">Save &amp; commit</button></div>';
    $('gitName').focus();
    $('gitSave').onclick = async () => {
      const name = $('gitName').value.trim(), email = $('gitEmail').value.trim();
      if (!name || !/.+@.+/.test(email)) { $('gitEmail').style.borderColor = 'var(--red)'; return; }
      if (await api.setGitIdentity(name, email)) retry();
    };
  }

  renderCounts();
  goHome();
  askBox.focus();
  say(pick(LINES.idle), 4000);
})();
