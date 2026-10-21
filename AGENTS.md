# LemonCode: rules for agents

A desktop frame (Electron) around the real Claude Code CLI, with Citron the pixel lemon, a token meter and
project templates. How it works and the file map: README.md.

## Running it
- `npm start` from this folder, or the Desktop "LemonCode" shortcut (`npm run shortcut` rebuilds it).
- After editing anything in `src/`, restart the app; there is no hot reload.
- Debug: `npx electron . --remote-debugging-port=9333`, then talk to the page over CDP (screenshot, evaluate).
  Add `--user-data-dir=<temp folder>` to test next to a running LemonCode: it gets its own config and hooks file
  (it copies the old `lemon-code` config once, read-only).
- `npm test` runs the transcript-parsing tests in `test/`.

## Rules
- It runs the real `claude.exe` (`~/.local/bin`, native installer) in a terminal, not the Agent SDK: users sign in
  with their own Claude plan, and Anthropic restricts subscription logins in SDK-built apps.
- Hooks reach Citron only through the settings file the app writes to `%APPDATA%\lemoncode\hooks-settings.json`
  and passes with `--settings`. Never add them to `~/.claude/settings.json`: then every Claude session, not only
  the ones started here, would send events to Citron.
- `src/hook.js` must print nothing (UserPromptSubmit output goes into Claude's context) and always exit 0.
- The PTY is `@lydell/node-pty` because it ships Windows prebuilds (plain `node-pty` needs Visual Studio).
- A subagent can't pick its own API server, so a helper on a local model goes through `src/router.js`, which
  `ANTHROPIC_BASE_URL` points at. Only sessions with a local helper get that variable; keep it that way, since the
  router sees every call. The name `lemon-gpt-oss-20b` is in three places (`src/router.js`, the Modelfile, and
  the helper list in `src/renderer/app.js`): change them together.
- The meter's main number is input + output + cache writes; cache reads are shown but not counted. Messages are
  deduped by message id + request id (Claude Code writes one line per content block).
- Citron is drawn in code (`src/renderer/citron.js`), not image files. `npm run icon` redraws the app icon from it.
- Never commit `node_modules/`; `build/` output is fine to rebuild.
- It's meant to be shared: nothing personal in the code. Only "Blank" is built in; every other template is one
  the user makes and keeps in `config.json`.

## Gotchas
- Claude asks "trust this folder?" for every new folder, even inside a trusted parent. New project folders are
  pre-trusted in `~/.claude.json` (`projects["C:/path"].hasTrustDialogAccepted`), backed up first. Only folders
  LemonCode creates are pre-trusted; don't extend this to folders the user picks.
- If LemonCode is started from inside another Claude session, its `CLAUDECODE`/`CLAUDE_CODE_*` variables
  (and `ANTHROPIC_BASE_URL`) leak into our Claude and turn off transcripts; `cleanEnv()` strips them.
- Hooks use Node if installed, else `ELECTRON_RUN_AS_NODE=1 electron.exe` (Claude runs hooks in Git Bash, so the
  `VAR=1 cmd` prefix works). Both paths were tested.
- A PC may have no git identity yet, and then commits fail. COMPLETE asks for a name and email once and saves them globally.
- Helper agents go in as `--agents '<json>'` (keys: description, prompt, model, effort) on the command line;
  the file form only works with `--print`. Tested: the subagent transcript showed Haiku for a Haiku helper.
  Effort is accepted but not visible in transcripts.
- Helpers run in the background by default, so Claude's `Stop` can fire before they finish; Citron waits
  ("Waiting for helpers…") until each started helper's `SubagentStop` (`agent_type`) arrives. `SubagentStop`
  also fires for internal subagents with no `agent_type`, and `SubagentHandback` / `SendFeedback` are internal
  tools: ignore them.
- Getting started's Ollama row is done only when Ollama is both installed and running: a server can answer on
  port 11434 from somewhere else, so "running" alone says nothing about the program.
- Getting started's model step runs Ollama by its full install path: a terminal opened after the winget install
  still has the old PATH.
- Local only runs every session on the local model. Claude Code's model names are mapped to it in
  `setup.js` (`localOnlyEnv`), helpers are forced to it, and a second router sends all calls to Ollama. Any new
  model name that Claude Code gets needs a mapping there too, or Ollama answers "model not found".
- Claude Code doesn't know the local model name, so it assumes a 200k window. The local sessions set
  `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from `LOCAL_CONTEXT_TOKENS` (router.js) to match the Modelfile's 64K. Change
  them together. `CLAUDE_CODE_AUTO_COMPACT_WINDOW` can't do this (it has a 100k minimum).
- Shift+Enter is sent as ESC+CR, which Claude Code treats as a newline.
- Ctrl+V pastes text itself; with no text on the clipboard it sends a raw Ctrl+V so Claude can grab an image.
- The data folder follows package.json's `name`. It was `%APPDATA%\lemon-code` before the LemonCode rename;
  `main.js` copies the old `config.json` across once. Check for the file, not the folder: Electron can create
  the new folder before `main.js` runs (seen when testing with `app.setPath('appData')`).
- The chat view reads the transcript, not the terminal. Transcripts also hold `api-request-blob` lines (system
  prompt text) and user lines that are really tool results or command echoes; `chatMessage()` only keeps
  `user`/`assistant` lines with real text. Add a test in `test/chat.test.js` for any new line type you hide.
- On `--resume` the whole history is read before the page has made the tab, so main keeps each tab's messages
  and the page fetches them (`chat:history`). Attach the feed's listener before `start()`.
- Approvals, questions, sign-in and the trust prompt can only be answered in the terminal, so the page switches
  to it for those and back after. Sign-in and trust fire no hooks: it opens the terminal if `SessionStart`
  hasn't come within 6 s.
- Open approvals are tracked by `tool_use_id` (PreToolUse/PostToolUse have it). `PermissionRequest` has none,
  so it's matched to the running call by tool + input. Denying (Esc) fires no hook at all: Esc in the
  terminal and the Chat button count as the answer. Tested with Ask first mode and Haiku.
- In the page, `.ask` is the home type box's class: don't reuse it for chat bubbles.
