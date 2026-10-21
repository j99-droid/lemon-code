// Short plain-English label for a tool call, used by Citron's status and by each helper's lines in the chat.
// helperName turns a helper's key (its subagent_type) into the name the user gave it.
const base = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() : '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function describeTool(tool, input = {}, helperName = (key) => key || 'a helper') {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return `Editing ${base(input.file_path || input.notebook_path)}`;
  if (tool === 'Read') return `Reading ${base(input.file_path)}`;
  if (tool === 'Bash' || tool === 'PowerShell') return `Running: ${clip(input.description || input.command || '', 40)}`;
  if (tool === 'Grep' || tool === 'Glob') return `Searching for ${clip(input.pattern || '', 30)}`;
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'Browsing the web';
  if (tool === 'Task' || tool === 'Agent') return `Sending ${helperName(input.subagent_type)}: ${clip(input.description || '', 34)}`;
  if (tool === 'TodoWrite' || /update_plan/.test(tool)) return 'Planning';
  if (tool === 'Skill') return `Using the ${input.skill || ''} skill`;
  if (tool === 'AskUserQuestion') return 'Got a question for you';
  if (/home-assistant/.test(tool)) return 'Talking to Home Assistant';
  if (/Browser|chrome/.test(tool)) return 'Using the browser';
  return clip(tool.replace(/^mcp__[^_]+__/, ''), 32);
}

module.exports = { describeTool };
