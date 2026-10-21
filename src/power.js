// The main Claude's model and effort, each picked with its own slider on the top bar.
// main.js passes them as --model and --effort. The page gets these lists from app:init, in slider order.
const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_MODEL = 'sonnet';
const DEFAULT_EFFORT = 'medium';

module.exports = { MODELS, EFFORTS, DEFAULT_MODEL, DEFAULT_EFFORT };
