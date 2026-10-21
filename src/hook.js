// Claude Code hook command: forwards the hook's JSON (stdin) to LemonCode so Citron can react.
// Runs under Electron-as-Node (ELECTRON_RUN_AS_NODE=1). Prints nothing: UserPromptSubmit output
// would be added to Claude's context. Always exits 0 so it can never block Claude.
const http = require('http');

const port = process.env.LEMON_PORT;
const tab = process.env.LEMON_TAB || '';
let body = '';
const done = () => process.exit(0);
setTimeout(done, 1500);

if (!port) done();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { body += d; });
process.stdin.on('end', () => {
  const req = http.request({
    host: '127.0.0.1', port, path: '/hook', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Lemon-Tab': tab },
  }, (res) => { res.resume(); res.on('end', done); });
  req.on('error', done);
  req.end(body);
});
