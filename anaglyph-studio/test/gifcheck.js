'use strict';
/* An independent GIF89a parser + LZW decoder, written from the spec, used to
   verify the encoder inside the app. Deliberately shares no code with it. */

function parseGif(buf) {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => { const v = buf[p] | (buf[p + 1] << 8); p += 2; return v; };
  const sig = buf.slice(0, 6).toString('latin1');
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('bad signature: ' + sig);
  p = 6;
  const width = u16(), height = u16();
  const packed = u8();
  const bgIndex = u8();
  const aspect = u8();
  const hasGCT = !!(packed & 0x80);
  const gctSize = hasGCT ? 1 << ((packed & 7) + 1) : 0;
  let gct = null;
  if (hasGCT) { gct = buf.slice(p, p + gctSize * 3); p += gctSize * 3; }

  const frames = [];
  let loopCount = null;
  let pendingDelay = null, pendingDisposal = null, pendingTransparent = null;

  const readSubBlocks = () => {
    const parts = [];
    for (;;) {
      const n = u8();
      if (n === 0) break;
      parts.push(buf.slice(p, p + n));
      p += n;
    }
    return Buffer.concat(parts);
  };

  for (;;) {
    if (p >= buf.length) throw new Error('unexpected end of file (no trailer)');
    const block = u8();
    if (block === 0x3B) break;                       // trailer
    if (block === 0x21) {                            // extension
      const label = u8();
      if (label === 0xF9) {
        const size = u8();
        if (size !== 4) throw new Error('bad GCE size ' + size);
        const gp = u8();
        pendingDisposal = (gp >> 2) & 7;
        pendingDelay = u16();
        pendingTransparent = u8();
        if (u8() !== 0) throw new Error('GCE not terminated');
      } else if (label === 0xFF) {
        const size = u8();
        const name = buf.slice(p, p + size).toString('latin1');
        p += size;
        const data = readSubBlocks();
        if (name === 'NETSCAPE2.0' && data[0] === 1) loopCount = data[1] | (data[2] << 8);
      } else {
        readSubBlocks();
      }
      continue;
    }
    if (block !== 0x2C) throw new Error('unknown block 0x' + block.toString(16) + ' at ' + (p - 1));
    const left = u16(), top = u16(), fw = u16(), fh = u16();
    const ipacked = u8();
    const hasLCT = !!(ipacked & 0x80);
    const interlaced = !!(ipacked & 0x40);
    let lct = null;
    if (hasLCT) { const n = 1 << ((ipacked & 7) + 1); lct = buf.slice(p, p + n * 3); p += n * 3; }
    const minCodeSize = u8();
    const data = readSubBlocks();
    const indices = lzwDecode(minCodeSize, data, fw * fh);
    frames.push({
      left, top, w: fw, h: fh, interlaced, hasLCT,
      delay: pendingDelay, disposal: pendingDisposal, transparent: pendingTransparent,
      minCodeSize, indices, dataBytes: data.length, palette: lct || gct,
    });
    pendingDelay = pendingDisposal = pendingTransparent = null;
  }
  return { width, height, bgIndex, aspect, gctSize, gct, frames, loopCount, trailerAt: p - 1, size: buf.length };
}

function lzwDecode(minCodeSize, data, expected) {
  if (minCodeSize < 2 || minCodeSize > 11) throw new Error('bad min code size ' + minCodeSize);
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let dict, codeSize, next;
  const reset = () => {
    dict = new Array(4096);
    for (let i = 0; i < clear; i++) dict[i] = [i];
    dict[clear] = []; dict[eoi] = [];
    next = eoi + 1;
    codeSize = minCodeSize + 1;
  };
  reset();
  const out = [];
  let bit = 0, prev = null;
  const total = data.length * 8;
  const read = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      bit++;
    }
    return code;
  };
  let sawEoi = false;
  while (bit + codeSize <= total) {
    const code = read();
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) { sawEoi = true; break; }
    let entry;
    if (dict[code] !== undefined && code < next) entry = dict[code];
    else if (code === next && prev !== null) entry = prev.concat([prev[0]]);
    else throw new Error('LZW: code ' + code + ' out of range (next=' + next + ', size=' + codeSize + ')');
    for (let i = 0; i < entry.length; i++) out.push(entry[i]);
    if (prev !== null && next < 4096) {
      dict[next] = prev.concat([entry[0]]);
      next++;
      if (next >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  if (!sawEoi) throw new Error('LZW: stream ended without an end-of-information code');
  if (expected != null && out.length !== expected) {
    throw new Error('LZW: decoded ' + out.length + ' pixels, expected ' + expected);
  }
  return out;
}

module.exports = { parseGif, lzwDecode };
