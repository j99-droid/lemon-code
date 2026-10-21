#!/usr/bin/env node

// Claude Code status line command. Gets the session's JSON on stdin, passes the rate limits to LemonCode's
// local server (the 5h and weekly bars) and prints a short line. Set by writeHookSettings in src/main.js, so it
// runs only in sessions LemonCode starts. Needs LEMON_PORT from the app. Always exits 0 so the line never breaks.
const fs = require('fs');
const http = require('http');

const TIMEOUT_MS = 1500; // a slow or missing server must not hold up the terminal's status line

// Returns { fiveHour, week } with resetsAt in ms, or null when Claude Code sent no rate limits.
// A window with a percent outside 0-100 or no reset time is dropped.
function parseLimits(json) {
  if (!json || !json.rate_limits) return null;
  const limits = {};
  const readWindow = (window) => {
    if (!window) return null;
    const percent = window.used_percentage;
    const resetsAt = window.resets_at;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null;
    if (typeof resetsAt !== 'number' || !(resetsAt > 0)) return null;
    return { percent, resetsAt: resetsAt * 1000 };
  };
  const fiveHour = readWindow(json.rate_limits.five_hour);
  const week = readWindow(json.rate_limits.seven_day);
  if (fiveHour) limits.fiveHour = fiveHour;
  if (week) limits.week = week;
  return Object.keys(limits).length ? limits : null;
}

function formatLine(limits) {
  const part = (label, window) => `${label} ${window ? `${Math.round(window.percent)}%` : '–'}`;
  return `${part('5h', limits.fiveHour)} · ${part('week', limits.week)}`;
}

if (require.main === module) {
  const port = process.env.LEMON_PORT;
  const finish = () => process.exit(0);
  setTimeout(finish, TIMEOUT_MS).unref();

  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let limits = null;
    try { limits = parseLimits(JSON.parse(input)); } catch { finish(); }
    if (!limits) finish();

    // Written synchronously so the line is not cut off when the process exits.
    fs.writeSync(1, `${formatLine(limits)}\n`);
    if (!port) finish(); // run by hand, outside LemonCode: just the line

    // The server checks the body again: any local process can post to it.
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/limits',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => { res.resume(); res.on('end', finish); });
    req.on('error', finish);
    req.end(input);
  });
}

module.exports = { parseLimits };
