'use strict';
/* Verification harness for anaglyph-studio/index.html.

   Strategy: synthesise a stereo pair whose misalignment we chose ourselves,
   let the app measure it, and compare the transform it derives against the
   exact inverse of the one we applied — in pixels of displacement, which is
   the only unit that matters here. Then exercise export, and validate the
   GIF byte-for-byte with an independent decoder. */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');
const { parseGif } = require('./gifcheck.js');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

/* Ground truth: how the "camera" moved between the two shots. */
const GEN = { tx: 14, ty: 9, rot: 1.7, scale: 1.023 };
const IW = 800, IH = 600, MX = 150, MY = 120;

let failures = 0, checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   [' + detail + ']' : ''));
}
function near(name, actual, expected, tol, unit) {
  const d = Math.abs(actual - expected);
  check(name, d <= tol, actual.toFixed(4) + ' vs ' + expected.toFixed(4) + ' (Δ' + d.toFixed(4) + (unit || '') + ', tol ' + tol + ')');
  return d;
}

/* --- matrix helpers (independent of the app's) --- */
const mul = (A, B) => ({
  a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
  c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
  e: A.a * B.e + A.c * B.f + A.e, f: A.b * B.e + A.d * B.f + A.f,
});
function inv(m) {
  const det = m.a * m.d - m.b * m.c;
  const ia = m.d / det, ib = -m.b / det, ic = -m.c / det, id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, e: -(ia * m.e + ic * m.f), f: -(ib * m.e + id * m.f) };
}
function genMatrix(p, W, H) {
  const cx = W / 2, cy = H / 2, r = p.rot * Math.PI / 180;
  const cos = Math.cos(r) * p.scale, sin = Math.sin(r) * p.scale;
  let m = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  m = mul({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, mul(m, { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy }));
  m.e += p.tx; m.f += p.ty;
  return m;
}
const applyPt = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

/** Largest displacement between two transforms over a grid of sample points. */
function maxDisplacement(m1, m2, W, H) {
  let worst = 0;
  for (let y = 0; y <= H; y += H / 8) {
    for (let x = 0; x <= W; x += W / 8) {
      const [x1, y1] = applyPt(m1, x, y), [x2, y2] = applyPt(m2, x, y);
      worst = Math.max(worst, Math.hypot(x1 - x2, y1 - y2));
    }
  }
  return worst;
}

/* --- fixture generation, run inside the browser --- */
const GENERATOR = ({ IW, IH, MX, MY, GEN }) => {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SW = IW + 2 * MX, SH = IH + 2 * MY;

  function paint(ctx, w, h, seed, layer) {
    const rnd = mulberry32(seed);
    if (layer === 0) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#20304a'); g.addColorStop(0.5, '#6a5340'); g.addColorStop(1, '#123027');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const x = rnd() * w, y = rnd() * h, s = 2 + rnd() * 9;
        ctx.fillStyle = 'hsl(' + (rnd() * 360 | 0) + ',' + (25 + rnd() * 45 | 0) + '%,' + (18 + rnd() * 55 | 0) + '%)';
        ctx.fillRect(x, y, s, s * (0.4 + rnd()));
      }
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      for (let i = 0; i < 60; i++) {
        ctx.lineWidth = 0.5 + rnd() * 2;
        ctx.beginPath(); ctx.moveTo(rnd() * w, rnd() * h); ctx.lineTo(rnd() * w, rnd() * h); ctx.stroke();
      }
    } else if (layer === 1) {
      for (let i = 0; i < 26; i++) {
        const x = rnd() * w, y = rnd() * h, r = 18 + rnd() * 55;
        ctx.fillStyle = 'hsl(' + (rnd() * 360 | 0) + ',65%,52%)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.font = 'bold 46px sans-serif'; ctx.fillStyle = '#ffe9a8';
      ctx.fillText('MIDGROUND', w * 0.16, h * 0.62);
    } else {
      for (let i = 0; i < 9; i++) {
        const x = 60 + rnd() * (w - 200), y = 60 + rnd() * (h - 200);
        const bw = 70 + rnd() * 130, bh = 60 + rnd() * 120;
        ctx.fillStyle = 'hsl(' + (rnd() * 360 | 0) + ',80%,60%)';
        ctx.fillRect(x, y, bw, bh);
        ctx.fillStyle = 'rgba(0,0,0,.75)';
        ctx.fillRect(x + 10, y + 10, bw - 20, 14);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(x, y, bw, bh);
      }
      ctx.font = 'bold 64px sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 5;
      ctx.strokeText('FOREGROUND', w * 0.2, h * 0.35);
      ctx.fillText('FOREGROUND', w * 0.2, h * 0.35);
    }
  }

  function scene(layerShifts) {
    const c = document.createElement('canvas');
    c.width = SW; c.height = SH;
    const x = c.getContext('2d');
    for (let layer = 0; layer < 3; layer++) {
      const tmp = document.createElement('canvas');
      tmp.width = SW; tmp.height = SH;
      const tx = tmp.getContext('2d');
      if (layer > 0) tx.clearRect(0, 0, SW, SH);
      paint(tx, SW, SH, 1234 + layer * 77, layer);
      x.drawImage(tmp, layerShifts[layer], 0);
    }
    return c;
  }

  function genMat(p, W, H) {
    const cx = W / 2, cy = H / 2, r = p.rot * Math.PI / 180;
    const cos = Math.cos(r) * p.scale, sin = Math.sin(r) * p.scale;
    // T(t) · T(c) · R·S · T(-c)
    const a = cos, b = sin, c2 = -sin, d = cos;
    const e = cx - (a * cx + c2 * cy) + p.tx;
    const f = cy - (b * cx + d * cy) + p.ty;
    return [a, b, c2, d, e, f];
  }

  function crop(src) {
    const c = document.createElement('canvas');
    c.width = IW; c.height = IH;
    c.getContext('2d').drawImage(src, MX, MY, IW, IH, 0, 0, IW, IH);
    return c.toDataURL('image/png');
  }
  function warp(src) {
    const c = document.createElement('canvas');
    c.width = IW; c.height = IH;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    const m = genMat(GEN, IW, IH);
    x.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    x.drawImage(src, -MX, -MY);
    return c.toDataURL('image/png');
  }

  const flat = scene([0, 0, 0]);                 // no parallax: pure calibration
  const stereoL = scene([0, 0, 0]);
  const stereoR = scene([0, -7, -19]);           // nearer layers shift further left
  return {
    calibLeft: crop(flat), calibRight: warp(flat),
    sceneLeft: crop(stereoL), sceneRight: warp(stereoR),
  };
};

function saveDataUrl(dataUrl, file) {
  const b64 = dataUrl.split(',')[1];
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}

/* --- static file server --- */
function serve(dir) {
  const types = { '.html': 'text/html', '.png': 'image/png', '.js': 'text/javascript', '.md': 'text/markdown' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(dir, p);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

(async () => {
  const { server, port } = await serve(APP_DIR);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1580, height: 940 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  console.log('\n--- generating fixtures ---');
  await page.goto('about:blank');
  const urls = await page.evaluate(GENERATOR, { IW, IH, MX, MY, GEN });
  const files = {
    calibLeft: saveDataUrl(urls.calibLeft, OUT + '/calib-left.png'),
    calibRight: saveDataUrl(urls.calibRight, OUT + '/calib-right.png'),
    sceneLeft: saveDataUrl(urls.sceneLeft, OUT + '/scene-left.png'),
    sceneRight: saveDataUrl(urls.sceneRight, OUT + '/scene-right.png'),
  };
  for (const k of Object.keys(files)) {
    console.log('  ' + path.basename(files[k]) + '  ' + fs.statSync(files[k]).size + ' bytes');
  }

  console.log('\n--- loading app ---');
  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => !!window.__anaglyph);
  // every panel section is reachable, but the collapsed ones are not
  // *visible* to the driver — open them all so the sweep can reach them.
  const openAll = pg => pg.evaluate(() => {
    for (const d of document.querySelectorAll('details.sec')) d.open = true;
  });
  await openAll(page);
  check('app boots with no console errors', errors.length === 0, errors.join(' | '));
  check('export buttons start disabled', await page.isDisabled('#btnExport'));

  /* ---------- unit tests of the pure helpers ---------- */
  console.log('\n--- unit: largest inscribed rectangle ---');
  const lr = await page.evaluate(() => {
    const cols = 10, rows = 6;
    const m = new Uint8Array(cols * rows);
    for (let r = 1; r <= 4; r++) for (let c = 2; c <= 7; c++) m[r * cols + c] = 1;
    return window.__anaglyph.largestRectangle(m, cols, rows);
  });
  check('finds the 6×4 block', lr.x === 2 && lr.y === 1 && lr.w === 6 && lr.h === 4, JSON.stringify(lr));

  console.log('\n--- unit: LZW round-trip against an independent decoder ---');
  for (const spec of [
    { name: 'flat run', n: 5000, gen: () => 7 },
    { name: 'random 8-colour', n: 40000, gen: (i, r) => r() * 8 | 0 },
    { name: 'random 200-colour', n: 120000, gen: (i, r) => r() * 200 | 0 },
    { name: 'ramp (forces table reset)', n: 400000, gen: (i) => (i * 37) % 251 },
    { name: 'single pixel', n: 1, gen: () => 3 },
  ]) {
    for (const mcs of [2, 4, 8]) {
      const maxIdx = (1 << mcs) - 1;
      const res = await page.evaluate(({ n, mcs, which }) => {
        let s = 12345;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        const px = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          let v;
          if (which === 0) v = 7;
          else if (which === 1) v = rnd() * 8 | 0;
          else if (which === 2) v = rnd() * 200 | 0;
          else if (which === 3) v = (i * 37) % 251;
          else v = 3;
          px[i] = v & ((1 << mcs) - 1);
        }
        const bytes = window.__anaglyph.lzwEncode(mcs, px);
        return { px: Array.from(px), bytes: Array.from(bytes) };
      }, { n: spec.n, mcs, which: ['flat run', 'random 8-colour', 'random 200-colour', 'ramp (forces table reset)', 'single pixel'].indexOf(spec.name) });
      void maxIdx;
      let ok = false, detail = '';
      try {
        const { lzwDecode } = require('./gifcheck.js');
        const decoded = lzwDecode(mcs, Buffer.from(res.bytes), res.px.length);
        ok = decoded.length === res.px.length && decoded.every((v, i) => v === res.px[i]);
        if (!ok) {
          const bad = decoded.findIndex((v, i) => v !== res.px[i]);
          detail = 'first mismatch at ' + bad;
        } else {
          detail = res.px.length + ' px → ' + res.bytes.length + ' B';
        }
      } catch (e) { detail = e.message; }
      check('LZW ' + spec.name + ' @ minCodeSize ' + mcs, ok, detail);
    }
  }

  /* ---------- alignment accuracy ---------- */
  console.log('\n--- auto-align accuracy against known ground truth ---');
  const seqStart = await page.evaluate(() => window.__anaglyph.seq);
  await page.setInputFiles('#fileL', files.calibLeft);
  await page.setInputFiles('#fileR', files.calibRight);
  await page.waitForFunction(s => window.__anaglyph.seq >= s + 2 && window.__anaglyph.loaded(), seqStart);
  const b = await page.evaluate(() => window.__anaglyph.base);
  check('base frame is the left image', b.w === IW && b.h === IH, JSON.stringify(b));

  await page.selectOption('#searchQuality', 'balanced');
  await page.selectOption('#searchRange', 'normal');
  const t0 = Date.now();
  await page.evaluate(() => window.__anaglyph.autoAlign());
  await page.waitForFunction(() => !window.__anaglyph.busy, null, { timeout: 120000 });
  const elapsed = Date.now() - t0;

  const got = await page.evaluate(() => {
    const A = window.__anaglyph;
    const p = A.eyeParams().full;
    return {
      S: { alignTy: A.S.alignTy, alignRot: A.S.alignRot, alignScale: A.S.alignScale, depth: A.S.depth },
      m: A.paramMatrix(p, A.base.w, A.base.h),
      result: A.autoResult,
    };
  });
  const expected = inv(genMatrix(GEN, IW, IH));
  const disp = maxDisplacement(got.m, expected, IW, IH);

  console.log('    recovered: ty=' + (got.S.alignTy / 100 * IH).toFixed(3) + 'px  rot=' + got.S.alignRot.toFixed(3) +
    '°  scale=' + got.S.alignScale.toFixed(3) + '%  depth=' + (got.S.depth / 100 * IW).toFixed(3) + 'px');
  console.log('    match score: ' + (got.result.score * 100).toFixed(2) + '%   time: ' + elapsed + ' ms');

  check('correlation score is high', got.result.score > 0.9, (got.result.score * 100).toFixed(2) + '%');
  check('max displacement error < 1.0 px over the whole frame', disp < 1.0, disp.toFixed(4) + ' px');
  near('rotation', got.S.alignRot, -GEN.rot, 0.05, '°');
  near('scale', got.S.alignScale, 100 / GEN.scale, 0.15, '%');
  const expTy = applyPt(expected, IW / 2, IH / 2)[1] - IH / 2;
  const expTx = applyPt(expected, IW / 2, IH / 2)[0] - IW / 2;
  near('vertical offset (px)', got.S.alignTy / 100 * IH, expTy, 0.6, 'px');
  near('horizontal offset / depth (px)', got.S.depth / 100 * IW, expTx, 0.9, 'px');
  check('auto-align finishes quickly', elapsed < 25000, elapsed + ' ms');

  /* ---------- realistic pair, views, export ---------- */
  console.log('\n--- realistic stereo pair ---');
  const seq0 = await page.evaluate(() => window.__anaglyph.seq);
  await page.setInputFiles('#fileL', files.sceneLeft);
  await page.setInputFiles('#fileR', files.sceneRight);
  await page.waitForFunction(s => window.__anaglyph.seq >= s + 2 && window.__anaglyph.loaded(), seq0);
  await page.evaluate(() => window.__anaglyph.autoAlign());
  await page.waitForFunction(() => !window.__anaglyph.busy, null, { timeout: 120000 });
  const scene = await page.evaluate(() => ({
    ty: window.__anaglyph.S.alignTy / 100 * window.__anaglyph.base.h,
    rot: window.__anaglyph.S.alignRot,
    scale: window.__anaglyph.S.alignScale,
    depth: window.__anaglyph.S.depth / 100 * window.__anaglyph.base.w,
    score: window.__anaglyph.autoResult.score,
  }));
  console.log('    recovered on layered scene: ty=' + scene.ty.toFixed(2) + 'px rot=' + scene.rot.toFixed(3) +
    '° scale=' + scene.scale.toFixed(3) + '% depth=' + scene.depth.toFixed(2) + 'px score=' + (scene.score * 100).toFixed(1) + '%');
  near('layered scene: vertical still recovered', scene.ty, expTy, 1.5, 'px');
  near('layered scene: rotation still recovered', scene.rot, -GEN.rot, 0.15, '°');

  console.log('\n--- views render ---');
  for (const v of ['anaglyph', 'left', 'right', 'diff', 'wiggle', 'sbs']) {
    await page.evaluate(view => window.__anaglyph.setView(view), v);
    await page.waitForTimeout(220);
    const nonBlank = await page.evaluate(() => {
      const c = document.getElementById('view');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) lit++;
      return lit;
    });
    check('view "' + v + '" paints something', nonBlank > 50, nonBlank + ' lit samples');
  }
  await page.evaluate(() => window.__anaglyph.setView('anaglyph'));
  await page.waitForTimeout(300);

  console.log('\n--- screenshots ---');
  await page.screenshot({ path: OUT + '/ui-anaglyph.png' });
  await page.selectOption('#overlay', 'lines');
  await page.evaluate(() => window.__anaglyph.setView('diff'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + '/ui-diff.png' });
  await page.selectOption('#overlay', 'none');
  await page.evaluate(() => window.__anaglyph.setView('anaglyph'));
  await page.waitForTimeout(300);
  console.log('    wrote ui-anaglyph.png, ui-diff.png');

  console.log('\n--- PNG export ---');
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport2')]);
  const pngPath = OUT + '/export.png';
  await pngDl.saveAs(pngPath);
  const png = fs.readFileSync(pngPath);
  check('PNG signature', png.slice(0, 8).toString('hex') === '89504e470d0a1a0a');
  const pngW = png.readUInt32BE(16), pngH = png.readUInt32BE(20);
  const wantSize = await page.evaluate(() => window.__anaglyph.outputSize());
  check('PNG dimensions match the reported output size',
    pngW === wantSize.w && pngH === wantSize.h, pngW + '×' + pngH + ' vs ' + wantSize.w + '×' + wantSize.h);
  check('PNG is non-trivial in size', png.length > 20000, png.length + ' bytes');

  console.log('\n--- GIF export ---');
  await page.fill('#n_gifScale', '50');
  await page.dispatchEvent('#n_gifScale', 'input');
  await page.waitForTimeout(150);
  const [gifDl] = await Promise.all([page.waitForEvent('download'), page.click('#btnGif2')]);
  const gifPath = OUT + '/wiggle.gif';
  await gifDl.saveAs(gifPath);
  const gif = fs.readFileSync(gifPath);
  let parsed = null, parseErr = '';
  try { parsed = parseGif(gif); } catch (e) { parseErr = e.message; }
  check('GIF parses with an independent decoder', !!parsed, parseErr);
  if (parsed) {
    const expectGif = await page.evaluate(() => {
      const g = window.__anaglyph;
      const c = g.cropRect();
      const s = (g.S.outScale / 100) * (g.S.gifScale / 100);
      return { w: Math.max(2, Math.round(c.w * s)), h: Math.max(2, Math.round(c.h * s)), delay: g.S.gifDelay };
    });
    check('GIF has two frames', parsed.frames.length === 2, parsed.frames.length + ' frames');
    check('GIF logical screen matches the app', parsed.width === expectGif.w && parsed.height === expectGif.h,
      parsed.width + '×' + parsed.height + ' vs ' + expectGif.w + '×' + expectGif.h);
    check('GIF loops forever', parsed.loopCount === 0, String(parsed.loopCount));
    for (let i = 0; i < parsed.frames.length; i++) {
      const f = parsed.frames[i];
      check('frame ' + i + ' decodes to exactly w×h pixels', f.indices.length === f.w * f.h,
        f.indices.length + ' vs ' + (f.w * f.h));
      const maxIdx = f.indices.reduce((a, v) => v > a ? v : a, 0);
      check('frame ' + i + ' indices stay inside the palette', maxIdx < parsed.gctSize,
        'max ' + maxIdx + ' / table ' + parsed.gctSize);
      check('frame ' + i + ' delay is ' + Math.round(expectGif.delay / 10) + ' cs',
        f.delay === Math.max(2, Math.round(expectGif.delay / 10)), String(f.delay));
    }
    const [f0, f1] = parsed.frames;
    let diff = 0;
    for (let i = 0; i < f0.indices.length; i++) if (f0.indices[i] !== f1.indices[i]) diff++;
    const pct = (100 * diff / f0.indices.length).toFixed(1);
    check('the two frames genuinely differ (the wiggle)', diff > f0.indices.length * 0.05, pct + '% of pixels differ');
    console.log('    GIF: ' + parsed.width + '×' + parsed.height + ', ' + parsed.gctSize +
      ' colours, ' + (gif.length / 1024).toFixed(0) + ' KB');
  }

  /* the browser is the ultimate authority on whether our GIF is valid */
  const gifRenders = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: 'image/gif' }));
    try {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = () => rej(new Error('decode failed')); im.src = url; });
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(im, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      let lit = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4 * 53) { if (d[i] + d[i + 1] + d[i + 2] > 24) lit++; sum++; }
      return { w: im.naturalWidth, h: im.naturalHeight, litFrac: lit / sum };
    } catch (e) {
      return { error: e.message };
    } finally { URL.revokeObjectURL(url); }
  }, gif.toString('base64'));
  check('Chromium decodes and renders the GIF',
    !gifRenders.error && gifRenders.litFrac > 0.5,
    JSON.stringify(gifRenders));

  console.log('\n--- controls sanity sweep ---');
  const methods = ['dubois', 'optimized', 'halfcolor', 'color', 'gray', 'true'];
  for (const m of methods) {
    await page.selectOption('#method', m);
    await page.waitForTimeout(180);
    const stats = await page.evaluate(() => {
      const c = document.getElementById('view');
      const g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let r = 0, gg = 0, bb = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 41) { if (d[i + 3] > 0) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; n++; } }
      return { r: r / n, g: gg / n, b: bb / n };
    });
    check('method "' + m + '" produces a lit image', stats.r + stats.g + stats.b > 30,
      'rgb ' + stats.r.toFixed(0) + ',' + stats.g.toFixed(0) + ',' + stats.b.toFixed(0));
  }
  await page.selectOption('#method', 'dubois');

  for (const [id, val] of [['alignMode', 'split'], ['quality', 'full'], ['quality', 'fast'], ['sbsOrder', 'cross']]) {
    await page.selectOption('#' + id, val);
    await page.waitForTimeout(160);
  }
  await page.selectOption('#alignMode', 'right');
  await page.selectOption('#quality', 'balanced');

  for (const m of ['gain', 'histogram', 'off']) {
    await page.selectOption('#exposureMatch', m);
    await page.waitForTimeout(160);
  }
  for (const id of ['swapEyes', 'cropOverlap', 'linearLight']) {
    await page.click('#' + id);
    await page.waitForTimeout(140);
    await page.click('#' + id);
    await page.waitForTimeout(140);
  }
  for (const s of ['ghost', 'rivalry', 'gainL', 'gainR', 'brightness', 'contrast', 'saturation',
    'outGamma', 'cropInset', 'framePct', 'diffGain', 'alignSkewX', 'alignSkewY', 'depth']) {
    await page.evaluate(id => {
      const sp = window.__anaglyph;
      const el = document.getElementById('r_' + id);
      el.value = String((parseFloat(el.min) + parseFloat(el.max)) / 2 + parseFloat(el.step));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      void sp;
    }, s);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  check('no errors after sweeping every control', errors.length === 0, errors.slice(0, 3).join(' | '));
  await page.screenshot({ path: OUT + '/ui-tweaked.png' });

  console.log('\n--- reset ---');
  await page.click('#btnResetAll');
  await page.waitForTimeout(300);
  const afterReset = await page.evaluate(() => ({
    S: JSON.parse(JSON.stringify(window.__anaglyph.S)),
    D: JSON.parse(JSON.stringify(window.__anaglyph.DEFAULTS)),
    stillLoaded: window.__anaglyph.loaded(),
  }));
  check('reset restores every default', JSON.stringify(afterReset.S) === JSON.stringify(afterReset.D),
    Object.keys(afterReset.S).filter(k => afterReset.S[k] !== afterReset.D[k]).join(','));
  check('reset keeps the loaded images', afterReset.stillLoaded);

  console.log('\n--- keyboard nudges ---');
  await page.evaluate(() => document.getElementById('view').focus());
  const before = await page.evaluate(() => window.__anaglyph.S.alignTy);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const after = await page.evaluate(() => window.__anaglyph.S.alignTy);
  const movedPx = (after - before) / 100 * IH;
  near('two ArrowUp presses move the right eye up 2 px', movedPx, -2, 0.01, 'px');

  console.log('\n--- file:// (offline, no server) ---');
  const page2 = await ctx.newPage();
  const err2 = [];
  page2.on('pageerror', e => err2.push(e.message));
  page2.on('console', m => { if (m.type() === 'error') err2.push(m.text()); });
  await page2.goto('file://' + APP_DIR + '/index.html');
  await page2.waitForFunction(() => !!window.__anaglyph);
  await openAll(page2);
  await page2.setInputFiles('#fileL', files.sceneLeft);
  await page2.setInputFiles('#fileR', files.sceneRight);
  await page2.waitForFunction(() => window.__anaglyph.seq >= 2 && window.__anaglyph.loaded());
  await page2.waitForTimeout(600);
  const offlinePaints = await page2.evaluate(() => {
    const c = document.getElementById('view');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) lit++;
    return lit;
  });
  check('works straight off the filesystem', offlinePaints > 50 && err2.length === 0,
    offlinePaints + ' lit; errors: ' + err2.join('|'));
  await page2.close();

  console.log('\n--- responsive layout ---');
  await page.setViewportSize({ width: 430, height: 900 });
  await page.waitForTimeout(400);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone-width viewport', overflow <= 1, overflow + ' px');
  await page.screenshot({ path: OUT + '/ui-mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1580, height: 940 });

  check('no console errors for the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  server.close();

  console.log('\n========================================');
  console.log(failures === 0 ? 'ALL ' + checks + ' CHECKS PASSED' : failures + ' of ' + checks + ' CHECKS FAILED');
  console.log('========================================\n');
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
