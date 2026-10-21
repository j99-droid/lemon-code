# Lemon Code: rules for agents

A desktop frame (Electron) around the real Claude Code CLI, with Citron the pixel lemon, a token meter and
project templates. How it works and the file map: README.md.

## Running it
- `npm start` from this folder, or the Desktop "Lemon Code" shortcut (`npm run shortcut` rebuilds it).
- After editing anything in `src/`, restart the app; there is no hot reload.
- Debug: `npx electron . --remote-debugging-port=9333`, then talk to the page over CDP (screenshot, evaluate).

## Rules
- It runs the real `claude.exe` (`~/.local/bin`, native installer) in a terminal, not the Agent SDK: users sign in
  with their own Claude plan, and Anthropic restricts subscription logins in SDK-built apps.
- Hooks reach Citron only through the settings file the app writes to `%APPDATA%\lemon-code\hooks-settings.json`
  and passes with `--settings`. Never add them to `~/.claude/settings.json`: then every Claude session, not only
  the ones started here, would send events to Citron.
- `src/hook.js` must print nothing (UserPromptSubmit output goes into Claude's context) and always exit 0.
- The PTY is `@lydell/node-pty` because it ships Windows prebuilds (plain `node-pty` needs Visual Studio).
- The meter's main number is input + output + cache writes; cache reads are shown but not counted. Messages are
  deduped by message id + request id (Claude Code writes one line per content block).
- Citron is drawn in code (`src/renderer/citron.js`), not image files. `npm run icon` redraws the app icon from it.
- Never commit `node_modules/`; `build/` output is fine to rebuild.
- It's meant to be shared: nothing personal in the code. Only "Blank" is built in; every other template is one
  the user makes and keeps in `config.json`.

## Gotchas
- Claude asks "trust this folder?" for every new folder, even inside a trusted parent. New project folders are
  pre-trusted in `~/.claude.json` (`projects["C:/path"].hasTrustDialogAccepted`), backed up first. Only folders
  Lemon Code creates are pre-trusted; don't extend this to folders the user picks.
- If Lemon Code is started from inside another Claude session, its `CLAUDECODE`/`CLAUDE_CODE_*` variables
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
- Shift+Enter is sent as ESC+CR, which Claude Code treats as a newline.
- Ctrl+V pastes text itself; with no text on the clipboard it sends a raw Ctrl+V so Claude can grab an image.
