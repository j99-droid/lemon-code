// Templates, kick-off prompts and new-project folder setup.
// Only "Blank" is built in. Everything else is a template the user makes, stored in config.templates as
// { id, name, icon, folder: null | "C:\\path", prompt }. folder null = a new project folder each time.

// Template briefs first, then what the user typed.
function buildPrompt(text, templates) {
  const typed = String(text || '').trim();
  const briefs = templates.filter((t) => t.prompt && t.prompt.trim());
  if (!briefs.length) return typed;
  const parts = briefs.map((t, i) => (briefs.length > 1 ? `${i + 1}. ${t.name}: ${t.prompt.trim()}` : t.prompt.trim()));
  if (briefs.length > 1) parts.unshift('I want to do these together:');
  if (typed) parts.push(`What I want: ${typed}`);
  return parts.join('\n\n');
}

const STOP = new Set(('a an the and or but to of for in on at by with from into about please can could would you i me my '
  + 'we our us it this that make build create want need let lets let\'s some new up get do help write add set use').split(' '));

// "Build me a heatmap dashboard for my sensors" -> "heatmap-dashboard-sensors"
function folderName(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((w) => w && !STOP.has(w)).slice(0, 4);
  const slug = words.join('-').replace(/-+/g, '-').slice(0, 40).replace(/-$/, '');
  if (slug) return slug;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `project-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const AGENTS_SKELETON = (name) => `# ${name}: rules for agents

What this is and how it works: README.md.

## Working rules
- Don't say something works unless you saw it work. Say what is still unverified.
- Never commit secrets, tokens, databases or logs. The pre-commit hook in \`.githooks/\` blocks the obvious ones;
  enable it in every clone with \`git config core.hooksPath .githooks\`.

## Gotchas
`;

module.exports = { buildPrompt, folderName, AGENTS_SKELETON };
