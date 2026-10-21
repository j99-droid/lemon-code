// The only bridge between the page and the main process.
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, ...args) => fn(...args));

// Frames inside the page (the HTML previews in question cards) must not reach the bridge: they can write to terminals.
if (window.top === window) contextBridge.exposeInMainWorld('lemon', {
  init: () => ipcRenderer.invoke('app:init'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),

  startProject: (text, templateIds, agentIds) => ipcRenderer.invoke('project:start', { text, templateIds, agentIds }),
  saveAgent: (a) => ipcRenderer.invoke('agents:save', a),
  deleteAgent: (id) => ipcRenderer.invoke('agents:delete', id),
  addStarterAgents: () => ipcRenderer.invoke('agents:starter'),
  resume: (s) => ipcRenderer.invoke('claude:resume', s),
  installClaude: () => ipcRenderer.invoke('claude:install'),
  setupStatus: (mode) => ipcRenderer.invoke('setup:status', mode),
  chooseSetup: (mode) => ipcRenderer.invoke('setup:choose', mode),
  installOllama: () => ipcRenderer.invoke('setup:install-ollama'),
  openOllamaPage: () => ipcRenderer.invoke('setup:open-ollama-page'),
  pullModel: () => ipcRenderer.invoke('setup:pull-model'),
  saveTemplate: (t) => ipcRenderer.invoke('templates:save', t),
  deleteTemplate: (id) => ipcRenderer.invoke('templates:delete', id),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),

  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.invoke('pty:kill', id),
  sendChat: (id, text) => ipcRenderer.send('chat:send', id, text),
  chatHistory: (id) => ipcRenderer.invoke('chat:history', id),
  answerQuestion: (id, toolUseId, answers) => ipcRenderer.invoke('ask:answer', { id, toolUseId, answers }),

  gitStatus: (id) => ipcRenderer.invoke('git:status', id),
  complete: (id, message) => ipcRenderer.invoke('complete', { id, message }),
  setGitIdentity: (name, email) => ipcRenderer.invoke('git:identity', { name, email }),
  toggleArchive: (sessionId) => ipcRenderer.invoke('archive:toggle', sessionId),
  openFolder: (dir) => ipcRenderer.invoke('open:folder', dir),

  onData: on('pty:data'),
  onExit: on('pty:exit'),
  onChat: on('chat'),
  onHook: on('hook'),
  onUsage: on('usage'),
  onLimits: on('limits'),
  onAssistantText: on('assistant-text'),
  onFocusTab: on('focus-tab'),
});
