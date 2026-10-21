// Citron: a 32x32 pixel lemon with Claude's starburst as its leaf.
// Drawn in code (no image files) so every pose shares one body.
// Usage: Citron.render(canvas, 'happy', frame, { flip: false })
(function (root) {
  'use strict';

  const S = 32;
  const C = {
    line: '#3b2a10', base: '#ffd23f', light: '#fff07a', shade: '#e9a91f', deep: '#c4831a',
    coral: '#d97757', coralDark: '#b4573a', coralLight: '#f0a183', eye: '#24180b', shine: '#ffffff', cheek: '#f4917a',
    mouth: '#6e2a1a', tongue: '#e8705a', metal: '#a9b1bb', metalDark: '#5d6670',
    glass: '#17171c', glassShine: '#6b6b7a', spark: '#fff6b0', ink: '#f1efe6', sweat: '#8fd3ff',
  };

  // Rows 2-9, x 11-20. o = lighter core, d = shaded lower rays.
  const BURST = [
    '....xx....',
    '.x..xx..x.',
    '..x.xx.x..',
    '..xxooxx..',
    'xxxooooxxx',
    '..ddoodd..',
    '..d.dd.d..',
    '.d..dd..d.',
  ];

  function inBody(x, y) {
    if ((x === 4 || x === 27) && (y === 18 || y === 19)) return true; // lemon tips
    const nx = (x + 0.5 - 16) / 11, ny = (y + 0.5 - 19) / 8.5;
    return nx * nx + ny * ny <= 1;
  }

  // ---- parts -------------------------------------------------------------

  function body(g) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (!inBody(x, y)) continue;
      const edge = !inBody(x - 1, y) || !inBody(x + 1, y) || !inBody(x, y - 1) || !inBody(x, y + 1);
      const nx = (x + 0.5 - 16) / 11, ny = (y + 0.5 - 19) / 8.5;
      const hx = nx + 0.45, hy = ny + 0.5, lit = nx * 0.4 + ny * 0.9;
      let c = C.base;
      if (edge) c = C.line;
      else if (hx * hx + hy * hy < 0.07) c = C.light;
      else if (lit > 0.85) c = C.deep;
      else if (lit > 0.6) c = C.shade;
      g.put(x, y, c);
    }
    g.put(15, 10, C.coralDark); g.put(16, 10, C.coralDark);
    const burstColor = { x: C.coral, o: C.coralLight, d: C.coralDark };
    BURST.forEach((row, i) => [...row].forEach((ch, j) => {
      if (burstColor[ch]) g.put(11 + j, 2 + i, burstColor[ch]);
    }));
  }

  function eyes(g, type) {
    for (const x0 of [11, 19]) {
      switch (type) {
        case 'open':
          g.rect(x0, 17, x0 + 1, 19, C.eye); g.put(x0, 17, C.shine); break;
        case 'wide':
          g.rect(x0, 16, x0 + 1, 19, C.eye); g.put(x0, 16, C.shine); g.put(x0 + 1, 16, C.shine);
          g.rect(x0, 14, x0 + 1, 14, C.line); break;
        case 'up':
          g.rect(x0, 16, x0 + 1, 17, C.eye); g.put(x0 + 1, 16, C.shine); break;
        case 'down':
          g.rect(x0, 18, x0 + 1, 19, C.eye); break;
        case 'closed':
          g.rect(x0, 18, x0 + 1, 18, C.eye); break;
        case 'happy':
          g.put(x0 - 1, 18, C.eye); g.put(x0, 17, C.eye); g.put(x0 + 1, 17, C.eye); g.put(x0 + 2, 18, C.eye); break;
        case 'squint':
          g.rect(x0, 18, x0 + 1, 18, C.eye); break;
      }
    }
    if (type === 'squint') { // brows slanting in
      g.put(11, 15, C.line); g.put(12, 15, C.line); g.put(13, 16, C.line);
      g.put(18, 16, C.line); g.put(19, 15, C.line); g.put(20, 15, C.line);
    }
  }

  function mouth(g, type) {
    const m = C.mouth;
    switch (type) {
      case 'smile': g.put(14, 21, m); g.put(15, 22, m); g.put(16, 22, m); g.put(17, 21, m); break;
      case 'flat': g.put(15, 22, m); g.put(16, 22, m); break;
      case 'smirk': g.put(15, 22, m); g.put(16, 22, m); g.put(17, 21, m); break;
      case 'o': g.rect(15, 21, 16, 22, m); break;
      case 'grin':
        g.put(13, 20, m); g.put(18, 20, m); g.rect(14, 21, 17, 21, m);
        g.put(14, 22, m); g.put(17, 22, m); g.rect(15, 22, 16, 22, C.tongue); g.rect(15, 23, 16, 23, m); break;
    }
  }

  function cheeks(g) { g.rect(9, 20, 10, 20, C.cheek); g.rect(21, 20, 22, 20, C.cheek); }

  function mirror(g, pts, c) { for (const [x, y] of pts) { g.put(x, y, c); g.put(31 - x, y, c); } }

  function armsDown(g) { mirror(g, [[4, 22], [3, 23], [3, 24]], C.line); }

  function armsUp(g) { mirror(g, [[4, 17], [3, 16], [2, 15], [2, 14]], C.line); }

  function wave(g, f) {
    for (const [x, y] of [[4, 22], [3, 23], [3, 24]]) g.put(x, y, C.line);
    const arm = f % 2 === 0
      ? [[27, 17], [28, 16], [29, 15], [30, 14], [30, 13]]
      : [[27, 17], [28, 16], [28, 15], [28, 14], [27, 13]];
    for (const [x, y] of arm) g.put(x, y, C.line);
  }

  function feet(g, f, walking) {
    const shift = walking ? (f % 2 === 0 ? 1 : -1) : 0;
    g.rect(11 - shift, 27, 12 - shift, 27, C.line);
    g.rect(19 + shift, 27, 20 + shift, 27, C.line);
  }

  function sparkle(g, x, y) {
    g.put(x, y, C.shine);
    g.put(x - 1, y, C.spark); g.put(x + 1, y, C.spark); g.put(x, y - 1, C.spark); g.put(x, y + 1, C.spark);
  }

  function thoughtDots(g, n) {
    if (n >= 1) g.put(24, 9, C.ink);
    if (n >= 2) g.rect(26, 6, 27, 7, C.ink);
    if (n >= 3) { g.rect(28, 2, 30, 4, C.ink); }
  }

  function sunglasses(g) {
    g.rect(9, 17, 13, 19, C.glass); g.rect(18, 17, 22, 19, C.glass);
    g.rect(14, 17, 17, 17, C.glass);
    g.put(10, 17, C.glassShine); g.put(19, 17, C.glassShine);
    g.rect(6, 17, 8, 17, C.glass); g.rect(23, 17, 25, 17, C.glass);
  }

  function laptop(g, f) {
    g.rect(9, 20, 22, 26, C.metal);
    g.rect(9, 20, 22, 20, C.metalDark); g.rect(9, 20, 9, 26, C.metalDark); g.rect(22, 20, 22, 26, C.metalDark);
    g.rect(7, 27, 24, 27, C.metalDark);
    g.rect(15, 22, 16, 23, C.coral);
    for (const [x, y] of [[14, 21], [17, 21], [14, 24], [17, 24]]) g.put(x, y, C.coral);
    g.put(8, f % 2 === 0 ? 26 : 25, C.line); g.put(23, f % 2 === 0 ? 25 : 26, C.line);
  }

  // ---- poses -------------------------------------------------------------
  // frames: how many frames loop; fps: speed; bob: vertical offset per frame.

  const POSES = {
    idle: {
      frames: 8, fps: 3, bob: [0, 0, 0, 0, 1, 1, 1, 1],
      draw(g, f) { eyes(g, f === 7 ? 'closed' : 'open'); mouth(g, 'smile'); cheeks(g); armsDown(g); feet(g, f, false); },
    },
    walk: {
      frames: 4, fps: 6, bob: [0, -1, 0, -1],
      draw(g, f) { eyes(g, 'open'); mouth(g, 'smile'); cheeks(g); armsDown(g); feet(g, f, true); },
    },
    thinking: {
      frames: 4, fps: 2.5, bob: [0, 0, 0, 0],
      draw(g, f) { eyes(g, 'up'); mouth(g, 'smirk'); armsDown(g); feet(g, f, false); thoughtDots(g, f); },
    },
    typing: {
      frames: 4, fps: 6, bob: [0, -1, 0, -1],
      draw(g, f) { eyes(g, 'open'); mouth(g, f % 2 ? 'o' : 'smile'); cheeks(g); armsDown(g); feet(g, f, false); },
    },
    coding: {
      frames: 4, fps: 6, bob: [0, 0, 0, 0],
      draw(g, f) { eyes(g, 'down'); feet(g, f, false); laptop(g, f); },
    },
    happy: {
      frames: 4, fps: 6, bob: [0, -1, -2, -1],
      draw(g, f) {
        eyes(g, 'happy'); mouth(g, 'grin'); cheeks(g); armsUp(g); feet(g, f, false);
        if (f % 2 === 0) { sparkle(g, 5, 8); sparkle(g, 27, 11); } else { sparkle(g, 7, 12); sparkle(g, 25, 6); }
      },
    },
    focused: {
      frames: 4, fps: 3, bob: [0, 0, 0, 0],
      draw(g, f) {
        eyes(g, 'squint'); mouth(g, 'flat'); armsDown(g); feet(g, f, false);
        g.put(25, 12 + (f % 2), C.sweat); g.put(25, 13 + (f % 2), C.sweat); g.put(24, 13 + (f % 2), C.sweat);
      },
    },
    chill: {
      frames: 8, fps: 2, bob: [0, 0, 0, 0, 1, 1, 1, 1],
      draw(g, f) { sunglasses(g); mouth(g, 'smirk'); cheeks(g); armsDown(g); feet(g, f, false); },
    },
    needs: {
      frames: 4, fps: 5, bob: [0, -1, 0, -1],
      draw(g, f) {
        eyes(g, 'wide'); mouth(g, 'o'); wave(g, f); feet(g, f, false);
        if (f % 2 === 0) { g.rect(5, 3, 6, 7, C.coral); g.rect(5, 9, 6, 10, C.coral); }
      },
    },
  };

  // ---- rendering ---------------------------------------------------------

  const rgbCache = {};
  function rgb(hex) {
    return rgbCache[hex] || (rgbCache[hex] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));
  }

  function pixels(pose, frame) {
    const spec = POSES[pose] || POSES.idle;
    const f = ((frame % spec.frames) + spec.frames) % spec.frames;
    const dy = spec.bob[f];
    const buf = new Array(S * S).fill(null);
    const g = {
      put(x, y, c) { y += dy; if (x >= 0 && x < S && y >= 0 && y < S) buf[y * S + x] = c; },
      rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g.put(x, y, c); },
    };
    body(g);
    spec.draw(g, f);
    return buf;
  }

  function render(canvas, pose, frame, opts) {
    const flip = opts && opts.flip;
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    const buf = pixels(pose, frame);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = buf[y * S + (flip ? S - 1 - x : x)];
      if (!c) continue;
      const [r, gg, b] = rgb(c), i = (y * S + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Animate a canvas; returns a controller with setPose() and stop().
  function animate(canvas, pose, opts) {
    let current = pose, frame = 0, timer = null, flip = !!(opts && opts.flip);
    function tick() {
      render(canvas, current, frame++, { flip });
      timer = setTimeout(tick, 1000 / (POSES[current] || POSES.idle).fps);
    }
    tick();
    return {
      setPose(p) { if (p !== current) { current = p; frame = 0; clearTimeout(timer); tick(); } },
      setFlip(v) { flip = v; },
      get pose() { return current; },
      stop() { clearTimeout(timer); },
    };
  }

  root.Citron = { POSES, pixels, render, animate, size: S };
})(typeof window !== 'undefined' ? window : globalThis);
