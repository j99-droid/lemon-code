# LemonCode 🍋

A friendlier window around Claude Code: type what you want and press Enter, your own templates, a live token
meter, a one-click COMPLETE button, and Citron, a pixel lemon who shows what Claude is doing.

## Requirements
Windows 10 or 11 (the app uses `claude.exe`, PowerShell and a Desktop shortcut, so nothing else is tested), plus
[Node.js](https://nodejs.org) for `npm install` and [Git](https://git-scm.com) for the project folders.

## Start
```
git clone https://github.com/j99-droid/lemoncode.git
cd lemoncode
git config core.hooksPath .githooks
npm install
npm start
```
Or double-click **LemonCode** on the Desktop (`npm run shortcut` makes it).

LemonCode runs Anthropic's **Claude Code** CLI in a window, so you need a Claude plan or account. The first start
opens **Getting started** on the home page. Pick one of three setups: **Claude account** (everything on Claude),
**Claude + local helpers** (Claude as usual, helpers on a model here), or **Local only** (every session on a model
here, no Claude account; see below). It checks Claude Code and Ollama and offers an Install button for each one
that's missing. Claude Code's button runs Anthropic's official installer (`irm https://claude.ai/install.ps1 | iex`),
and the first session of a Claude setup asks you to sign in with your Claude account. Reopen the panel any time from
⋯ → Getting started.

Citron's reactions come from a small hook server that LemonCode starts on `127.0.0.1` (a random local port). Only
sessions LemonCode starts are sent to it, but it has no password, so other programs on your PC could post to it.

## Local helpers (optional)
A helper can run on a model on your PC instead of Claude. It needs [Ollama](https://ollama.com) (0.14 or newer) and
the GPT-OSS 20B model. Getting started installs Ollama with winget and downloads the model for you, or do it by hand:
```
ollama pull gpt-oss:20b
ollama create lemon-gpt-oss-20b -f tools/local-model/Modelfile
```
Then pick **Local: GPT-OSS 20B** as a helper's model. Only sessions with a local helper use the local router
(`src/router.js`): it sends that helper's calls to Ollama and everything else to Anthropic, so your Claude sign-in
is unchanged. The main Claude is always Claude. Ollama must be running when the helper is used (it runs in the
tray after install). The model is about 13 GB and fits fully in 16 GB of GPU memory.

Speed (measured on an RTX 4080 Super with two small edits handed to a local helper):
- Local helpers are told to work one job at a time. Ollama answers one call at a time, so helpers side by side
  queued behind each other and calls took 30-90 s. One at a time, its prompt cache keeps each prompt warm.
- A helper's **effort** is how long gpt-oss thinks. The router moves Claude's names one step down (low and medium
  are gpt-oss low, high is medium, extra high and max are high): gpt-oss high thought for over a minute on a
  small function without answering. With LocalCoder on High, the test went from about 80 s to 41 s.
- A second Ollama slot (`OLLAMA_NUM_PARALLEL=2`) was tested and isn't needed: with one job at a time, the main
  prompt and the helper's take turns at 0.4-0.8 s a call from the cache.

**Local only** (the setup panel) runs every session on that model instead: no Claude account is used, and calls
go to Ollama only. Claude Code is still needed as the program that runs the session. Your MCP servers are left
out (`--strict-mcp-config`) so their tools don't fill the prompt; it still starts at about 36K tokens. The model
is smaller and weaker than Claude, and its context window is 64K, so long sessions lose their oldest messages.

## What's on screen
- **Type box** (home page): type what you want, press Enter. With **Blank** picked, LemonCode makes a folder in
  the projects folder (default `~\Lemon Projects`) named from your words, with git, AGENTS.md, CLAUDE.md
  (`@AGENTS.md`), `.gitignore` and the secrets pre-commit hook, marks it trusted in `~/.claude.json` (backup in
  `~/.claude.json.lemon-backup`) and starts Claude with your words as the first prompt.
- **Helpers** (under the type box): tick which helper agents join the project. They're passed to Claude Code as
  subagents (`--agents`), each with its own role, model and effort, plus a short system-prompt note telling the
  main Claude to hand matching work to them. A resumed session gets the same helpers back.
- **Templates** (toggle under the helpers, closed each time the app opens): Blank is built in; ＋ New template
  saves a name, icon, folder (new each time, or always the same), the helpers it brings and a starting prompt.
- **Tabs**: ⌂ New project (home) first, then one tab per running session (dot = Citron's state for it, plus
  how many helpers are working). **⋯** opens **Agents** (make, edit, delete helpers; "Add starter team"),
  **Recent** (all Claude Code sessions to reopen or archive) and **Archived projects**.
- **Chat view** (each session opens in it): what you and Claude say, as chat bubbles, plus each helper as its own
  member of a group chat: its icon, when it starts and finishes, what it is doing (reading, editing, running) and
  what it says, live as it works. Claude's own tool calls and their output are left out. Type in the box at the
  bottom: Enter sends, Shift+Enter is a new line, Esc stops Claude, and pasting an image adds it to your next
  message. **Terminal** in the session header switches to Claude's real terminal and back.
- **Question cards**: when Claude asks you something, the chat shows a card with each question's options (tick
  boxes for pick-many questions, and "Type something" for your own answer). Option previews show as Markdown,
  code, or live HTML in a sandboxed frame with no network. Send answer types your choices into Claude's dialog.
  The terminal still opens by itself for approvals, sign-in and "trust this folder?", and goes back to chat after.
- **Model / Effort / Mode**: for the main Claude, applied to sessions started after you change them. Model and
  Effort each have a slider (lists in `src/power.js`). The arm beside them grows with both: a weak arm for Haiku
  at low effort, a huge arm with fire for Fable at max.
- **5h and Week bars**: your Claude plan's 5-hour and weekly limits as a percent, with reset times, as Claude
  Code reports them to its status line (Pro/Max plans, after the first reply; the last values are kept across
  restarts). Click a bar for that window's tokens, sessions, cache reads and a per-model breakdown. Those token
  totals come from this PC's transcripts, so they won't add up to the percent, which also counts claude.ai and
  other computers. Local-model calls are shown separately and left out. Hidden in Local only.
- **COMPLETE**: asks "Is that all?", offers a commit if there are changes (never pushes), closes the session and
  moves it to Archived projects. If git has no name/email yet it asks once and saves them globally.
- **Citron**: reacts to hooks from sessions started here: thinking, typing, coding (with what it's doing),
  focused (long tool runs), happy (finished), chill (quiet a minute), needs-you (approval or question). When the
  window isn't in front, approvals also pop a Windows notification.

## Files
| File | What it does |
|---|---|
| `src/main.js` | Window, Claude terminals (node-pty), chat feeds, hook listener, git, project creation |
| `src/usage.js` | Reads transcripts for token totals per limit window and the session list |
| `test/usage.test.js` | Tests for the usage totals (`npm test`) |
| `src/statusline.js` | Claude Code status line command: passes the 5h and weekly limits to the app |
| `test/statusline.test.js` | Tests for reading the limits (`npm test`) |
| `src/chat.js` | Follows one session's transcript and its helpers' transcripts for the chat view |
| `test/chat.test.js` | Tests for which transcript lines the chat view shows (`npm test`) |
| `src/activity.js` | Short labels for tool calls ("Editing notes.md"), for Citron and helper bubbles |
| `src/questions.js` | Turns a question card's answers into the keys Claude's question dialog reads |
| `test/questions.test.js` | Tests for those keys (`npm test`) |
| `src/router.js` | Local model router: sends a local helper's calls to Ollama, the rest to Anthropic |
| `test/router.test.js` | Tests for where the router sends each call (`npm test`) |
| `tools/local-model/Modelfile` | Makes the `lemon-gpt-oss-20b` model with a 64K context (see Local helpers) |
| `src/setup.js` | Getting started checks: Claude Code, Ollama and the local model, and the install and pull commands |
| `test/setup.test.js` | Tests for what counts as ready and how Ollama's answer is read (`npm test`) |
| `src/hook.js` | Hook command: forwards Claude's hook JSON to the app |
| `src/templates.js` | Folder naming, prompt building, AGENTS.md skeleton |
| `src/power.js` | The model and effort slider lists, in slider order, and the defaults |
| `src/renderer/arm.js` | Draws the flexed arm on the Power slider (SVG in code, fire at the top step) |
| `AGENTS.md` / `CLAUDE.md` | Rules for AI agents working on this repo (`CLAUDE.md` just loads `AGENTS.md`) |
| `.githooks/pre-commit` | Blocks committing secrets, databases and logs (enabled by the `core.hooksPath` line above) |
| `LICENSE` | MIT |
| `src/preload.js` | Safe bridge between page and main process |
| `src/renderer/` | The page: `index.html`, `styles.css`, `app.js`, `citron.js` (the sprite) |
| `src/renderer/chatview.js` | Draws chat bubbles, helper bubbles and question cards (Markdown, previews) |
| `src/renderer/preview-frame.html` | Holds one HTML preview from a question card, sandboxed with no network |
| `preview/citron-preview.html` | Sprite sheet of every pose (serve the folder over http to view) |
| `tools/make-icon.js` | Redraws `build/icon.png` / `icon.ico` from Citron |
| `tools/make-shortcut.ps1` | Makes the Desktop shortcut |
| `templates/githooks/pre-commit` | Secrets hook copied into new projects |

## Settings
Stored in `%APPDATA%\lemoncode\config.json`: daily budget, archived sessions, model, effort, mode, `projectsRoot`
(default `~\Lemon Projects`), your templates and agents, which helpers each session had, and an optional
`claudePath`.

## License
MIT. See [LICENSE](LICENSE).
