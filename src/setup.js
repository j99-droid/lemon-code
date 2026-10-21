// Getting started: checks what the setup panel needs (Claude Code, Ollama, the local model) and builds the
// commands it runs. Ollama is asked over its HTTP API on the same port the router sends local calls to.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { OLLAMA, LOCAL_MODEL } = require('./router');

// The base model the Modelfile builds from (its FROM line). Keep the two in step.
const LOCAL_BASE_MODEL = 'qwen3-coder:30b';
const MODELFILE = path.join(__dirname, '..', 'tools', 'local-model', 'Modelfile');
// Winget is built into Windows 10 and 11. The page is the fallback when it's missing.
const OLLAMA_INSTALL_COMMAND = 'winget install --id Ollama.Ollama -e --accept-package-agreements --accept-source-agreements';
const OLLAMA_DOWNLOAD_PAGE = 'https://ollama.com/download';
const TAGS_TIMEOUT_MS = 1500;

// Which setup the user picked. 'local-helpers' keeps the main session on Claude and only helpers run locally.
// 'local' runs every session on the local model: Claude Code is still the program, but no account is used.
const MODES = ['claude', 'local-helpers', 'local'];

function ollamaExe() {
  const installed = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Programs', 'Ollama', 'ollama.exe');
  if (fs.existsSync(installed)) return installed;
  try { return execFileSync('where', ['ollama'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim() || null; } catch { return null; }
}

// Model names the server lists look like "lemon-qwen3-coder:latest".
function hasLocalModel(names) {
  return names.some((name) => name.split(':')[0] === LOCAL_MODEL);
}

// Resolves with the model names Ollama has, or null when no server answers (not running).
function ollamaModels(endpoint = OLLAMA) {
  return new Promise((resolve) => {
    const req = http.get({ host: endpoint.host, port: endpoint.port, path: '/api/tags', timeout: TAGS_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).models.map((m) => m.name)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => req.destroy());
  });
}

async function ollamaStatus() {
  const installed = !!ollamaExe();
  const models = await ollamaModels();
  return {
    installed,
    running: models !== null,
    modelReady: models !== null && hasLocalModel(models),
  };
}

// True when everything the chosen mode needs is in place.
function isReady(mode, status) {
  const claudeOk = !!status.claude;
  const localOk = status.ollama.installed && status.ollama.running && status.ollama.modelReady;
  if (mode === 'claude') return claudeOk;
  if (mode === 'local-helpers' || mode === 'local') return claudeOk && localOk;
  return false;
}

// Environment for a session that runs only on the local model. Every model name Claude Code uses (its main
// model, its small fast model, the aliases) points at the local one, and the token stops the sign-in prompt.
// Calls go through the router, which sends them all to Ollama. The non-essential traffic switch turns off
// telemetry and the updater, the only other calls Claude Code makes to Anthropic.
function localOnlyEnv(routerPort) {
  return {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${routerPort}`,
    ANTHROPIC_AUTH_TOKEN: 'ollama', // any value works; the local router ignores it
    ANTHROPIC_DEFAULT_HAIKU_MODEL: LOCAL_MODEL,
    ANTHROPIC_DEFAULT_SONNET_MODEL: LOCAL_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: LOCAL_MODEL,
    ANTHROPIC_SMALL_FAST_MODEL: LOCAL_MODEL,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  };
}

// PowerShell single-quoted string: the only escape is a doubled quote.
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;

// Pulls the base model, then builds the local one from the Modelfile. Ollama runs as a tray app, so the
// full path is used: a terminal opened now still has the old PATH.
function modelSetupScript(exe) {
  const run = `& ${psQuote(exe)}`;
  return `${run} pull ${LOCAL_BASE_MODEL}; if ($?) { ${run} create ${LOCAL_MODEL} -f ${psQuote(MODELFILE)} }`;
}

module.exports = {
  MODES, OLLAMA_INSTALL_COMMAND, OLLAMA_DOWNLOAD_PAGE, ollamaExe, ollamaModels, ollamaStatus, hasLocalModel,
  isReady, localOnlyEnv, psQuote, modelSetupScript,
};
