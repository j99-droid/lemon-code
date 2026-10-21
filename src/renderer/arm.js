// Flexed arm for the Power slider: a noodle at level 0, a huge arm with fire at level 5.
// Drawn as SVG in code (no image files), like Citron.
// Usage: Arm.svg(level) returns the markup for one arm.
(function (root) {
  'use strict';

  const FIRE_LEVEL = 5;
  const C = { line: '#3b2a10', skin: '#ffd23f', fireRed: '#e5484d', fireOrange: '#ff8a1f', fireYellow: '#fff07a' };
  // Teardrop flame, base centred on (0, 0), about 12 units tall.
  const FLAME = 'M-4 0 C-5 -5 -2 -7 0 -12 C2 -7 5 -5 4 0 C3 3 -3 3 -4 0 Z';

  // Each shape gets a dark outline drawn first, then the skin colour on top.
  const limb = (x1, y1, x2, y2, width) => `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.line}" stroke-width="${width + 2.4}" stroke-linecap="round"/>
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${C.skin}" stroke-width="${width}" stroke-linecap="round"/>`;
  const ball = (x, y, r) => `
    <circle cx="${x}" cy="${y}" r="${r + 1.2}" fill="${C.line}"/>
    <circle cx="${x}" cy="${y}" r="${r}" fill="${C.skin}"/>`;
  const flame = (x, y, s) => `
    <path d="${FLAME}" transform="translate(${x} ${y}) scale(${s})" fill="${C.fireRed}"/>
    <path d="${FLAME}" transform="translate(${x} ${y - 1.5 * s}) scale(${s * 0.7})" fill="${C.fireOrange}"/>
    <path d="${FLAME}" transform="translate(${x} ${y - 3 * s}) scale(${s * 0.4})" fill="${C.fireYellow}"/>`;

  function svg(level) {
    const biceps = 3 + level * 1.1; // grows from a bump to a ball
    const fist = 4 + level * 0.25;
    const fire = level >= FIRE_LEVEL
      ? flame(27, 22, 0.8) + flame(33, 15, 1) + flame(40, 14, 1.2)
      : '';
    return `<svg viewBox="0 0 48 48" aria-hidden="true">${fire}
    <g transform="translate(0 8)">
      <rect x="1" y="24" width="10" height="12" rx="2" fill="#d97757" stroke="${C.line}" stroke-width="1.5"/>
      ${limb(9, 30, 22, 30, 8)}
      ${ball(16, 30, biceps)}
      ${limb(22, 30, 36, 14, 7)}
      ${ball(38, 10, fist)}
    </g></svg>`;
  }

  root.Arm = { svg };
})(typeof window !== 'undefined' ? window : globalThis);
