'use strict';
/* Edge cases: mismatched aspect ratios, one image only, very large images,
   frame borders, every export format, and the extremes of the GIF settings. */

const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('playwright');
const { parseGif } = require('./gifcheck.js');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');

let failures = 0, checks = 0;
const check = (n, ok, d) => { checks++; if (!ok) failures++; console.log((ok ? '  PASS  ' : '  FAIL  ') + n + (d ? '   [' + d + ']' : '')); };

function serve(dir) {
  const srv = http.createServer((q, s) => {
    const f = path.join(dir, q.url === '/' ? '/index.html' : q.url.split('?')[0]);
    fs.readFile(f, (e, d) => e ? s.writeHead(404).end() : s.writeHead(200, { 'Content-Type': 'text/html' }).end(d));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/** Crops a window out of a bigger scene, optionally rotated — i.e. two real
 *  cameras framing the same subject differently, at the same pixel scale. */
const CROP = ({ sw, sh, seed, x0, y0, w, h, rot }) => {
  const scene = document.createElement('canvas');
  scene.width = sw; scene.height = sh;
  const sx = scene.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = sx.createLinearGradient(0, 0, sw, sh);
  g.addColorStop(0, '#2b3a4d'); g.addColorStop(1, '#6d5033');
  sx.fillStyle = g; sx.fillRect(0, 0, sw, sh);
  for (let i = 0; i < 1600; i++) {
    sx.fillStyle = 'hsl(' + (rnd() * 360 | 0) + ',70%,' + (22 + rnd() * 55 | 0) + '%)';
    const bw = 5 + rnd() * 34;
    sx.fillRect(rnd() * sw, rnd() * sh, bw, bw * 0.75);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.translate(w / 2, h / 2);
  x.rotate(rot * Math.PI / 180);
  x.translate(-w / 2, -h / 2);
  x.drawImage(scene, -x0, -y0);
  return c.toDataURL('image/png');
};

const MAKE = ({ w, h, seed, rot, dx, dy }) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  x.save();
  x.translate(w / 2 + dx, h / 2 + dy);
  x.rotate(rot * Math.PI / 180);
  x.translate(-w / 2, -h / 2);
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#334455'); g.addColorStop(1, '#775533');
  x.fillStyle = g; x.fillRect(-w, -h, w * 3, h * 3);
  for (let i = 0; i < 700; i++) {
    x.fillStyle = 'hsl(' + (rnd() * 360 | 0) + ',70%,' + (25 + rnd() * 50 | 0) + '%)';
    const bw = 6 + rnd() * 40;
    x.fillRect(rnd() * w, rnd() * h, bw, bw * 0.7);
  }
  x.restore();
  return c.toDataURL('image/png');
};

function save(dataUrl, file) {
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

(async () => {
  const { srv, port } = await serve(APP_DIR);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('about:blank');
  const fx = {};
  fx.a = save(await page.evaluate(CROP, { sw: 1400, sh: 1050, seed: 5, x0: 250, y0: 190, w: 800, h: 600, rot: 0 }), OUT + '/r-800x600.png');
  fx.square = save(await page.evaluate(CROP, { sw: 1400, sh: 1050, seed: 5, x0: 312, y0: 178, w: 600, h: 600, rot: 1.1 }), OUT + '/r-600x600.png');
  fx.bigL = save(await page.evaluate(MAKE, { w: 3200, h: 2400, seed: 9, rot: 0, dx: 0, dy: 0 }), OUT + '/r-big-l.png');
  fx.bigR = save(await page.evaluate(MAKE, { w: 3200, h: 2400, seed: 9, rot: -1.4, dx: 26, dy: -31 }), OUT + '/r-big-r.png');

  await page.goto('http://127.0.0.1:' + port + '/index.html');
  await page.waitForFunction(() => !!window.__anaglyph);
  await page.evaluate(() => { for (const d of document.querySelectorAll('details.sec')) d.open = true; });

  console.log('\n--- one image only ---');
  await page.setInputFiles('#fileL', fx.a);
  await page.waitForFunction(() => window.__anaglyph.seq >= 1);
  await page.waitForTimeout(400);
  check('auto-align stays disabled with one eye', await page.isDisabled('#btnAuto'));
  check('empty-state message still shown', await page.isVisible('#empty'));
  check('no errors with a single image', errors.length === 0, errors.join('|'));

  console.log('\n--- mismatched framing and aspect (800×600 vs 600×600 of the same scene) ---');
  await page.setInputFiles('#fileR', fx.square);
  await page.waitForFunction(() => window.__anaglyph.seq >= 2 && window.__anaglyph.loaded());
  await page.evaluate(() => window.__anaglyph.autoAlign());
  await page.waitForFunction(() => !window.__anaglyph.busy, null, { timeout: 120000 });
  const mm = await page.evaluate(() => ({
    base: window.__anaglyph.base,
    crop: window.__anaglyph.cropRect(),
    out: window.__anaglyph.outputSize(),
    score: window.__anaglyph.autoResult && window.__anaglyph.autoResult.score,
  }));
  check('base stays the left image', mm.base.w === 800 && mm.base.h === 600, JSON.stringify(mm.base));
  check('crop is inside the base frame and positive',
    mm.crop.w > 0 && mm.crop.h > 0 && mm.crop.x >= 0 && mm.crop.x + mm.crop.w <= 800.5,
    JSON.stringify(mm.crop, (k, v) => typeof v === 'number' ? +v.toFixed(1) : v));
  check('crop excludes the letterboxed sides (600² fitted into 800×600 covers ≤600 px wide)',
    mm.crop.w <= 601, mm.crop.w.toFixed(1) + ' px wide');
  check('alignment still finds a match', mm.score > 0.5, ((mm.score || 0) * 100).toFixed(1) + '%');
  check('no errors on mismatched sizes', errors.length === 0, errors.join('|'));

  console.log('\n--- swap sources ---');
  await page.click('#btnSwapSrc');
  await page.waitForTimeout(400);
  const sw = await page.evaluate(() => window.__anaglyph.base);
  check('swapping makes the 600² image the base', sw.w === 600 && sw.h === 600, JSON.stringify(sw));
  await page.click('#btnSwapSrc');
  await page.waitForTimeout(300);

  console.log('\n--- 3200×2400 pair ---');
  await page.setInputFiles('#fileL', fx.bigL);
  await page.setInputFiles('#fileR', fx.bigR);
  await page.waitForFunction(() => window.__anaglyph.seq >= 6 && window.__anaglyph.loaded(), null, { timeout: 60000 });
  const tBig = Date.now();
  await page.evaluate(() => window.__anaglyph.autoAlign());
  await page.waitForFunction(() => !window.__anaglyph.busy, null, { timeout: 180000 });
  const bigMs = Date.now() - tBig;
  const big = await page.evaluate(() => ({
    ty: window.__anaglyph.S.alignTy / 100 * window.__anaglyph.base.h,
    tx: window.__anaglyph.S.depth / 100 * window.__anaglyph.base.w,
    rot: window.__anaglyph.S.alignRot,
    score: window.__anaglyph.autoResult.score,
    out: window.__anaglyph.outputSize(),
  }));
  console.log('    8 MP pair: ty=' + big.ty.toFixed(2) + 'px tx=' + big.tx.toFixed(2) + 'px rot=' +
    big.rot.toFixed(3) + '° score=' + (big.score * 100).toFixed(1) + '% in ' + bigMs + ' ms');
  // Ground truth: right was drawn rotated +1.4° about centre... actually -1.4°, then
  // shifted (+26,-31). The correction is the inverse of that.
  check('8 MP: vertical recovered within 1 px', Math.abs(big.ty - 31) < 1.5, big.ty.toFixed(2) + ' vs ~+31');
  check('8 MP: rotation recovered within 0.1°', Math.abs(big.rot - 1.4) < 0.1, big.rot.toFixed(3) + '° vs ~+1.4');
  check('8 MP: horizontal recovered within 1.5 px', Math.abs(big.tx + 26) < 2.0, big.tx.toFixed(2) + ' vs ~-26');
  check('8 MP alignment under 30 s', bigMs < 30000, bigMs + ' ms');

  const tRender = await page.evaluate(async () => {
    const t = performance.now();
    window.__anaglyph.requestRender();
    await new Promise(r => setTimeout(r, 600));
    return performance.now() - t;
  });
  check('8 MP preview stays interactive', tRender < 3000, Math.round(tRender) + ' ms round trip');

  console.log('\n--- export formats and frame border ---');
  await page.evaluate(() => {
    const el = document.getElementById('r_framePct');
    el.value = '4'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    const s = document.getElementById('r_outScale');
    s.value = '25'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  for (const [what, fmt, ext] of [['anaglyph', 'png', 'png'], ['sbs', 'jpeg', 'jpg'], ['left', 'webp', 'webp'], ['right', 'png', 'png']]) {
    await page.selectOption('#exportWhat', what);
    await page.selectOption('#exportFormat', fmt);
    await page.waitForTimeout(250);
    const want = await page.evaluate(() => window.__anaglyph.outputSize());
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport2')]);
    const f = OUT + '/r-' + what + '.' + ext;
    await dl.saveAs(f);
    const buf = fs.readFileSync(f);
    let w = 0, h = 0, okSig = false;
    if (ext === 'png') { okSig = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a'; w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); }
    else if (ext === 'jpg') {
      okSig = buf[0] === 0xFF && buf[1] === 0xD8;
      let i = 2;
      while (i < buf.length - 1) {
        if (buf[i] !== 0xFF) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else {
      okSig = buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
      if (buf.slice(12, 16).toString('latin1') === 'VP8X') { w = (buf.readUIntLE(24, 3)) + 1; h = (buf.readUIntLE(27, 3)) + 1; }
      else if (buf.slice(12, 16).toString('latin1') === 'VP8L') { const b = buf.readUInt32LE(21); w = (b & 0x3FFF) + 1; h = ((b >> 14) & 0x3FFF) + 1; }
      else { w = buf.readUInt16LE(26) & 0x3FFF; h = buf.readUInt16LE(28) & 0x3FFF; }
    }
    check(what + ' as ' + ext.toUpperCase() + ': valid header', okSig, buf.length + ' bytes');
    check(what + ' as ' + ext.toUpperCase() + ': size ' + want.w + '×' + want.h,
      w === want.w && h === want.h, 'got ' + w + '×' + h);
  }
  await page.selectOption('#exportWhat', 'anaglyph');
  await page.selectOption('#exportFormat', 'png');

  console.log('\n--- GIF palette extremes ---');
  for (const colors of [8, 256]) {
    for (const dither of [true, false]) {
      await page.evaluate(c => {
        const el = document.getElementById('r_gifColors');
        el.value = String(c); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        const s = document.getElementById('r_gifScale');
        s.value = '40'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
      }, colors);
      const want = dither;
      const isOn = await page.isChecked('#gifDither');
      if (isOn !== want) await page.click('#gifDither');
      await page.waitForTimeout(250);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnGif2')]);
      const f = OUT + '/r-gif-' + colors + (dither ? '-dither' : '') + '.gif';
      await dl.saveAs(f);
      let p = null, err = '';
      try { p = parseGif(fs.readFileSync(f)); } catch (e) { err = e.message; }
      check('GIF @ ' + colors + ' colours' + (dither ? ' + dither' : '') + ' decodes',
        !!p && p.frames.length === 2 && p.frames.every(fr => fr.indices.length === fr.w * fr.h),
        p ? p.gctSize + '-entry table, ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB' : err);
      if (p) {
        const over = p.frames.some(fr => fr.indices.some(v => v >= p.gctSize));
        check('GIF @ ' + colors + (dither ? ' + dither' : '') + ': all indices within the table', !over);
      }
    }
  }

  console.log('\n--- clear ---');
  await page.click('#btnClear');
  await page.waitForTimeout(400);
  check('clearing disables the actions', await page.isDisabled('#btnGif2') && await page.isDisabled('#btnExport2'));
  check('clearing shows the empty state', await page.isVisible('#empty'));
  check('no console errors across every edge case', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close(); srv.close();
  console.log('\n' + (failures === 0 ? 'ALL ' + checks + ' EDGE-CASE CHECKS PASSED' : failures + ' of ' + checks + ' FAILED') + '\n');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
