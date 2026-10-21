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

LemonCode runs Anthropic's **Claude Code** CLI in a window, so you need a Claude plan or account. If Claude Code
isn't installed, the home page has an Install button, which runs Anthropic's official installer
(`irm https://claude.ai/install.ps1 | iex`). The first session asks you to sign in with your Claude account.

Citron's reactions come from a small hook server that LemonCode starts on `127.0.0.1` (a random local port). Only
sessions LemonCode starts are sent to it, but it has no password, so other programs on your PC could post to it.

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
- **Model / Effort / Mode**: for the main Claude, applied to sessions started after you change them.
- **Meter**: today's tokens against a daily budget (your 14-day average until you set one), the 5-hour window
  reset time, 7-day average, today's projection and a 7-day chart. Counts every Claude Code session, desktop
  app included. Click it for details and to set the budget.
- **COMPLETE**: asks "Is that all?", offers a commit if there are changes (never pushes), closes the session and
  moves it to Archived projects. If git has no name/email yet it asks once and saves them globally.
- **Citron**: reacts to hooks from sessions started here: thinking, typing, coding (with what it's doing),
  focused (long tool runs), happy (finished), chill (quiet a minute), needs-you (approval or question). When the
  window isn't in front, approvals also pop a Windows notification.

## Files
| File | What it does |
|---|---|
| `src/main.js` | Window, Claude terminals (node-pty), hook listener, git, project creation |
| `src/usage.js` | Reads transcripts for token totals, 5h window and the session list |
| `src/hook.js` | Hook command: forwards Claude's hook JSON to the app |
| `src/templates.js` | Folder naming, prompt building, AGENTS.md skeleton |
| `AGENTS.md` / `CLAUDE.md` | Rules for AI agents working on this repo (`CLAUDE.md` just loads `AGENTS.md`) |
| `.githooks/pre-commit` | Blocks committing secrets, databases and logs (enabled by the `core.hooksPath` line above) |
| `LICENSE` | MIT |
| `src/preload.js` | Safe bridge between page and main process |
| `src/renderer/` | The page: `index.html`, `styles.css`, `app.js`, `citron.js` (the sprite) |
| `preview/citron-preview.html` | Sprite sheet of every pose (serve the folder over http to view) |
| `tools/make-icon.js` | Redraws `build/icon.png` / `icon.ico` from Citron |
| `tools/make-shortcut.ps1` | Makes the Desktop shortcut |
| `templates/githooks/pre-commit` | Secrets hook copied into new projects |

## Settings
Stored in `%APPDATA%\lemoncode\config.json`: daily budget, archived sessions, model, mode, `projectsRoot`
(default `~\Lemon Projects`), your templates and agents, which helpers each session had, and an optional
`claudePath`.

## License
MIT. See [LICENSE](LICENSE).
