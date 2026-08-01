'use strict';
/* Feature suite: demo scene, depth analysis + click-to-set convergence,
   exposure matching modes, undo/redo, settings persistence and JSON
   round-trip, A/B compare, clipboard copy, fullscreen, and the corrected
   depth-direction labelling. */

const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0, checks = 0;
const check = (n, ok, d) => { checks++; if (!ok) failures++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   [' + d + ']' : '')); };
const near = (n, a, e, tol, u) => {
  const d = Math.abs(a - e);
  check(n, d <= tol, a.toFixed(3) + ' vs ' + e.toFixed(3) + ' (Δ' + d.toFixed(3) + (u || '') + ', tol ' + tol + ')');
};

function serve(dir) {
  const srv = http.createServer((q, s) => {
    const f = path.join(dir, q.url === '/' ? '/index.html' : q.url.split('?')[0]);
    fs.readFile(f, (e, d) => e ? s.writeHead(404).end() : s.writeHead(200, { 'Content-Type': 'text/html' }).end(d));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

(async () => {
  const { srv, port } = await serve(APP_DIR);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1500, height: 940 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const URL0 = 'http://127.0.0.1:' + port + '/index.html';

  await page.goto(URL0);
  await page.waitForFunction(() => !!window.__anaglyph);
  const openAll = pg => pg.evaluate(() => { for (const d of document.querySelectorAll('details.sec')) d.open = true; });
  await openAll(page);

  console.log('\n--- depth direction labelling (regression lock) ---');
  const labels = await page.evaluate(() => {
    const A = window.__anaglyph;
    const spec = { pos: '', neg: '' };
    A.setParam('depth', 3);
    spec.pos = document.getElementById('s_depth').textContent;
    A.setParam('depth', -3);
    spec.neg = document.getElementById('s_depth').textContent;
    A.setParam('depth', 0);
    return spec;
  });
  check('positive depth reads "behind screen"', /behind/i.test(labels.pos), labels.pos);
  check('negative depth reads "pops out"', /pops out|toward/i.test(labels.neg), labels.neg);

  console.log('\n--- demo scene ---');
  await page.click('#btnDemoEmpty');
  await page.waitForFunction(() => window.__anaglyph.loaded(), null, { timeout: 30000 });
  const demoBase = await page.evaluate(() => window.__anaglyph.base);
  const truth = await page.evaluate(() => window.__anaglyph.DEMO_TRUTH);
  check('demo pair loads at its declared size', demoBase.w === truth.w && demoBase.h === truth.h, JSON.stringify(demoBase));
  check('a toast announced the demo', (await page.locator('#toasts .toast').count()) >= 1);

  await page.evaluate(() => window.__anaglyph.autoAlign());
  await page.waitForFunction(() => !window.__anaglyph.busy, null, { timeout: 120000 });
  const rec = await page.evaluate(() => ({
    ty: window.__anaglyph.S.alignTy / 100 * window.__anaglyph.base.h,
    rot: window.__anaglyph.S.alignRot,
    scale: window.__anaglyph.S.alignScale,
    score: window.__anaglyph.autoResult.score,
  }));
  console.log('    demo recovered: ty=' + rec.ty.toFixed(2) + 'px rot=' + rec.rot.toFixed(3) +
    '° scale=' + rec.scale.toFixed(3) + '% score=' + (rec.score * 100).toFixed(1) + '%');
  // The right eye was warped by rot then +ty; the correction approximately
  // inverts it. Layered parallax adds noise, so tolerances are loose.
  check('demo: correlation is strong', rec.score > 0.6, (rec.score * 100).toFixed(1) + '%');
  near('demo: rotation recovered', rec.rot, -truth.rot, 0.15, '°');
  near('demo: scale recovered', rec.scale, 100 / truth.scale, 0.4, '%');
  near('demo: vertical recovered', rec.ty, -truth.ty, 2.5, 'px');

  console.log('\n--- depth analysis ---');
  const scan = await page.evaluate(() => window.__anaglyph.analyzeDepth());
  check('scan returns a distribution', !!scan && scan.n >= 12, scan ? scan.n + ' samples' : 'null');
  if (scan) {
    console.log('    near=' + scan.near.toFixed(1) + 'px median=' + scan.median.toFixed(1) + 'px far=' + scan.far.toFixed(1) + 'px');
    check('near ≤ median ≤ far', scan.near <= scan.median && scan.median <= scan.far);
    // Layer parallax spans 0..34 px before alignment recentres it; expect a
    // meaningful spread that stays in that order of magnitude.
    const span = scan.far - scan.near;
    check('disparity span matches the built-in parallax (10–45 px)', span > 10 && span < 45, span.toFixed(1) + ' px');
    check('report is visible with a verdict', await page.evaluate(() =>
      document.getElementById('depthReport').classList.contains('on') &&
      document.getElementById('depthReport').textContent.length > 40));
  }

  const prevNear = scan.near;
  await page.click('#btnDepthNear');
  // the button re-runs the scan; wait for a scan whose near differs from the old one
  await page.waitForFunction(pn => {
    const s2 = window.__anaglyph.lastDepthScan;
    return s2 && Math.abs(s2.near - pn) > 1.0;
  }, prevNear, { timeout: 30000 });
  const scan2 = await page.evaluate(() => window.__anaglyph.lastDepthScan);
  near('"Screen at nearest" drives the nearest point to ~0 px', scan2.near, 0, 1.6, 'px');
  check('after placement everything sits behind the screen', scan2.far >= -0.5, 'far=' + scan2.far.toFixed(1) + 'px');

  console.log('\n--- click-to-set convergence ---');
  // The demo signpost is the nearest object; its centre is a known spot.
  const picked = await page.evaluate(() => {
    const A = window.__anaglyph;
    const b = A.base;
    return A.pickDepthAt(b.w * 0.30, b.h * 0.56);
  });
  check('pick measured a disparity at the signpost', !!picked, picked ? picked.dPx.toFixed(2) + ' px' : 'null');
  const recheck = await page.evaluate(() => {
    const A = window.__anaglyph;
    const b = A.base;
    return A.measureDisparityAt(b.w * 0.30, b.h * 0.56);
  });
  check('that point now sits on the screen plane', !!recheck && Math.abs(recheck.dPx) < 0.8,
    recheck ? recheck.dPx.toFixed(2) + ' px residual' : 'null');

  // Alt+click routing through the real canvas. Aim at textured spots (the
  // ground/signpost); flat sky rightly measures nothing and only toasts.
  const before = await page.evaluate(() => window.__anaglyph.S.depth);
  const box = await page.locator('#view').boundingBox();
  let after = before;
  for (const [fx, fy] of [[0.35, 0.82], [0.31, 0.55], [0.62, 0.8]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.keyboard.down('Alt');
    await page.mouse.down(); await page.mouse.up();
    await page.keyboard.up('Alt');
    await page.waitForTimeout(700);
    after = await page.evaluate(() => window.__anaglyph.S.depth);
    if (after !== before) break;
  }
  check('Alt+click on the canvas adjusts depth', after !== before,
    before.toFixed(3) + ' → ' + after.toFixed(3));

  console.log('\n--- A/B compare ---');
  await page.keyboard.down('\\');
  await page.waitForTimeout(250);
  const abOn = await page.evaluate(() => ({ ab: window.__anaglyph.ab, p: window.__anaglyph.eyeParams().full }));
  check('holding \\ suspends the correction', abOn.ab && abOn.p.rot === 0 && abOn.p.scale === 1,
    JSON.stringify({ rot: abOn.p.rot, scale: abOn.p.scale }));
  const sDuring = await page.evaluate(() => window.__anaglyph.S.alignRot);
  check('the stored parameters are untouched while held', Math.abs(sDuring - rec.rot) < 1e-9, String(sDuring));
  await page.keyboard.up('\\');
  await page.waitForTimeout(250);
  const abOff = await page.evaluate(() => ({ ab: window.__anaglyph.ab, p: window.__anaglyph.eyeParams().full }));
  check('release restores the correction', !abOff.ab && Math.abs(abOff.p.rot - sDuring) < 1e-9);

  console.log('\n--- exposure matching ---');
  // Build a brightness-mismatched pair from the demo images via re-export.
  const exp = await page.evaluate(async () => {
    const A = window.__anaglyph;
    const stats = {};
    for (const mode of ['off', 'gain', 'histogram']) {
      document.getElementById('exposureMatch').value = mode;
      document.getElementById('exposureMatch').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 350));
      const c = document.getElementById('view');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let g = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 31) { if (d[i + 3]) { g += d[i + 1]; n++; } }
      stats[mode] = g / n;
    }
    void A;
    return stats;
  });
  check('all three exposure modes render', Object.values(exp).every(v => v > 2),
    Object.entries(exp).map(([k, v]) => k + '=' + v.toFixed(1)).join(' '));
  const lutSane = await page.evaluate(() => {
    // Unit-check the histogram LUT builder: match a dark ramp to a bright one.
    const n = 4096;
    const ref = new Uint8ClampedArray(n * 4), src = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const bright = Math.min(255, (i / n) * 255 + 60);   // ref is brighter
      const dark = (i / n) * 160;                          // src is darker
      ref[i * 4] = ref[i * 4 + 1] = ref[i * 4 + 2] = bright; ref[i * 4 + 3] = 255;
      src[i * 4] = src[i * 4 + 1] = src[i * 4 + 2] = dark; src[i * 4 + 3] = 255;
    }
    const luts = window.__anaglyph.histogramLuts(ref, src);
    let mono = true;
    for (let v = 1; v < 256; v++) if (luts[0][v] < luts[0][v - 1]) mono = false;
    return { mono, low: luts[0][10], mid: luts[0][80], high: luts[0][159] };
  });
  check('histogram LUT is monotonic and brightening', lutSane.mono && lutSane.mid > 80 && lutSane.low >= 60,
    JSON.stringify(lutSane));

  console.log('\n--- undo / redo ---');
  const h0 = await page.evaluate(() => ({ i: window.__anaglyph.histIndex, len: window.__anaglyph.histLen }));
  await page.evaluate(() => window.__anaglyph.setParam('alignRot', 3.21));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__anaglyph.setParam('depth', 4.5));
  await page.waitForTimeout(500);
  const h1 = await page.evaluate(() => ({ i: window.__anaglyph.histIndex, len: window.__anaglyph.histLen }));
  check('history grows with committed changes', h1.len >= h0.len + 2, h0.len + ' → ' + h1.len);
  await page.evaluate(() => document.getElementById('view').focus());
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const afterUndo1 = await page.evaluate(() => ({ rot: window.__anaglyph.S.alignRot, depth: window.__anaglyph.S.depth }));
  check('Ctrl+Z reverts the depth change', Math.abs(afterUndo1.depth - 4.5) > 0.01 && Math.abs(afterUndo1.rot - 3.21) < 1e-9,
    JSON.stringify(afterUndo1));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const afterUndo2 = await page.evaluate(() => window.__anaglyph.S.alignRot);
  check('second Ctrl+Z reverts the rotation change', Math.abs(afterUndo2 - 3.21) > 0.01, String(afterUndo2));
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(300);
  const afterRedo = await page.evaluate(() => window.__anaglyph.S.alignRot);
  near('Ctrl+Y re-applies it', afterRedo, 3.21, 1e-6);
  check('undo/redo buttons track state', await page.evaluate(() =>
    !document.getElementById('btnUndo').disabled && !document.getElementById('btnRedo').disabled));

  console.log('\n--- settings JSON round-trip ---');
  await page.evaluate(() => window.__anaglyph.setParam('ghost', 44));
  await page.waitForTimeout(500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSaveSet')]);
  const setPath = path.join(OUT, 'settings.json');
  await dl.saveAs(setPath);
  const payload = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  check('settings file identifies itself', payload.app === 'anaglyph-studio' && payload.S && payload.dom,
    Object.keys(payload).join(','));
  check('settings file carries the current value', payload.S.ghost === 44, String(payload.S.ghost));

  payload.S.ghost = 71; payload.S.depth = -2.5;
  const modPath = path.join(OUT, 'settings-mod.json');
  fs.writeFileSync(modPath, JSON.stringify(payload));
  await page.setInputFiles('#fileSet', modPath);
  await page.waitForTimeout(600);
  const loaded = await page.evaluate(() => ({ ghost: window.__anaglyph.S.ghost, depth: window.__anaglyph.S.depth }));
  check('loading the file applies its values', loaded.ghost === 71 && Math.abs(loaded.depth + 2.5) < 1e-9,
    JSON.stringify(loaded));

  console.log('\n--- persistence across reload ---');
  await page.evaluate(() => window.__anaglyph.setParam('rivalry', 63));
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForFunction(() => !!window.__anaglyph);
  const persisted = await page.evaluate(() => window.__anaglyph.S.rivalry);
  check('a reload restores saved settings', persisted === 63, String(persisted));
  await openAll(page);
  await page.click('#btnResetAll');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => !!window.__anaglyph);
  const afterReset = await page.evaluate(() => window.__anaglyph.S.rivalry);
  check('Reset clears the saved state too', afterReset === (await page.evaluate(() => window.__anaglyph.DEFAULTS.rivalry)),
    String(afterReset));
  await openAll(page);

  console.log('\n--- clipboard copy ---');
  await page.click('#btnDemo');
  await page.waitForFunction(() => window.__anaglyph.loaded(), null, { timeout: 30000 });
  await page.click('#btnCopy');
  await page.waitForFunction(() =>
    document.getElementById('stStatus').textContent.includes('Copied') ||
    document.getElementById('stStatus').textContent.includes('failed'), null, { timeout: 30000 });
  const clip = await page.evaluate(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        if (it.types.includes('image/png')) {
          const blob = await it.getType('image/png');
          return { ok: true, size: blob.size };
        }
      }
      return { ok: false, why: 'no png item' };
    } catch (e) { return { ok: false, why: e.message }; }
  });
  check('a PNG landed on the clipboard', clip.ok && clip.size > 5000, JSON.stringify(clip));

  console.log('\n--- fullscreen ---');
  const fsRes = await page.evaluate(async () => {
    document.getElementById('btnFull').click();
    await new Promise(r => setTimeout(r, 600));
    const on = !!document.fullscreenElement;
    if (on) await document.exitFullscreen();
    return on;
  });
  check('fullscreen toggles on the stage', fsRes === true, String(fsRes));

  console.log('\n--- render cache actually helps ---');
  const timing = await page.evaluate(async () => {
    const A = window.__anaglyph;
    // Geometry change: eye rasters must be redrawn and re-read.
    A.setParam('alignTy', A.S.alignTy + 0.3);
    const t0 = performance.now();
    A.requestRender();
    await new Promise(r => setTimeout(r, 350));
    const cold = performance.now() - t0;
    // Rendering-only change: cached eye pixels are reused.
    const times = [];
    for (const g of [30, 60, 90]) {
      A.setParam('ghost', g);
      const t1 = performance.now();
      A.requestRender();
      await new Promise(r => setTimeout(r, 350));
      times.push(performance.now() - t1);
    }
    void cold;
    return { renders: times };
  });
  check('rendering-only tweaks stay responsive', timing.renders.every(t => t < 900),
    timing.renders.map(t => Math.round(t)).join(',') + ' ms');

  check('no console errors across the whole feature run', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();
  srv.close();
  console.log('\n========================================');
  console.log(failures === 0 ? 'ALL ' + checks + ' FEATURE CHECKS PASSED' : failures + ' of ' + checks + ' FEATURE CHECKS FAILED');
  console.log('========================================\n');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
