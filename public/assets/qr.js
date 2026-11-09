/* Park Pulse QR — a small, self-contained QR code reader and writer.
   No third-party code (the CSP only allows our own scripts) and no network.

   PPQR.decode(imageData)            → { text, segments, version, ecl, mask } or null
   PPQR.encodeSegments(segs, ecl, v) → { size, version, ecl, mask, modules: Uint8Array }
   PPQR.encodeText(text)             → same, choosing the most compact mode
   PPQR.svgPath(qr, border)          → { d, dim } for an <svg viewBox="0 0 dim dim"><path d=…>

   The reader is a compact take on the classic approach (ZXing-style hybrid binariser, finder-pattern
   scan, perspective sampling, Reed–Solomon error correction). The writer follows the QR spec
   (ISO/IEC 18004) the way Project Nayuki's reference implementation lays it out. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ GF(256), polynomial 0x11D
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
  const gdiv = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);
  const gpow = (e) => EXP[((e % 255) + 255) % 255];

  // ------------------------------------------------------------------ tables (index 0 unused)
  // Error-correction levels by index: 0 = L, 1 = M, 2 = Q, 3 = H.
  const ECC = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
  const FORMAT_ECL = [1, 0, 3, 2]; // L, M, Q, H as written in the format bits
  const ECL_NAMES = ['L', 'M', 'Q', 'H'];
  const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const CC_BITS = { 1: [10, 12, 14], 2: [9, 11, 13], 4: [8, 16, 16], 8: [8, 10, 12] };
  const ccBits = (mode, ver) => CC_BITS[mode][ver <= 9 ? 0 : ver <= 26 ? 1 : 2];

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  // ------------------------------------------------------------------ structure shared by reader and writer
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = (ver, ecl) => Math.floor(rawModules(ver) / 8) - ECC[ecl][ver] * BLOCKS[ecl][ver];

  function alignPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const out = [6];
    for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function formatBits(ecl, mask) {
    const data = (FORMAT_ECL[ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | (rem & 0x3FF)) ^ 0x5412;
  }

  /** Two copies of the 15 format bits: [x, y] for bit 0…14. */
  function formatCoords(size) {
    const a = [];
    const b = [];
    for (let i = 0; i <= 5; i++) a.push([8, i]);
    a.push([8, 7], [8, 8], [7, 8]);
    for (let i = 9; i < 15; i++) a.push([14 - i, 8]);
    for (let i = 0; i < 8; i++) b.push([size - 1 - i, 8]);
    for (let i = 8; i < 15; i++) b.push([8, size - 15 + i]);
    return [a, b];
  }

  function versionBits(ver) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return (ver << 12) | (rem & 0xFFF);
  }

  /** Function patterns (finders, timing, alignment, format/version areas) for a version. */
  function functionGrid(ver) {
    const size = ver * 4 + 17;
    const mod = new Uint8Array(size * size);
    const fn = new Uint8Array(size * size);
    const set = (x, y, dark) => { mod[y * size + x] = dark ? 1 : 0; fn[y * size + x] = 1; };
    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(x, y, d !== 2 && d !== 4);
        }
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const al = alignPositions(ver);
    const n = al.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
    const [fa, fb] = formatCoords(size);
    for (const [x, y] of fa.concat(fb)) set(x, y, false);
    set(8, size - 8, true);
    if (ver >= 7) {
      const bits = versionBits(ver);
      for (let i = 0; i < 18; i++) {
        const bit = (bits >>> i) & 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, bit); set(b, a, bit);
      }
    }
    return { size, mod, fn };
  }

  /** Data module positions in placement order (two-column zigzag from bottom right). */
  function zigzag(size, fn) {
    const out = [];
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (!fn[y * size + x]) out.push(y * size + x);
        }
      }
    }
    return out;
  }

  function blockLayout(ver, ecl) {
    const nb = BLOCKS[ecl][ver];
    const ecLen = ECC[ecl][ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const numShort = nb - (raw % nb);
    const shortLen = Math.floor(raw / nb);
    return { nb, ecLen, raw, numShort, shortLen, shortData: shortLen - ecLen };
  }

  // ------------------------------------------------------------------ Reed–Solomon
  function rsGenerator(deg) {
    const r = new Array(deg).fill(0);
    r[deg - 1] = 1;
    let rootV = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        r[j] = gmul(r[j], rootV);
        if (j + 1 < deg) r[j] ^= r[j + 1];
      }
      rootV = gmul(rootV, 2);
    }
    return r;
  }

  function rsRemainder(data, gen) {
    const r = new Array(gen.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      for (let i = 0; i < gen.length; i++) r[i] ^= gmul(gen[i], f);
    }
    return r;
  }

  function syndromes(c, nsym) {
    const S = new Array(nsym);
    let bad = false;
    for (let j = 0; j < nsym; j++) {
      const a = gpow(j);
      let s = 0;
      for (let i = 0; i < c.length; i++) s = gmul(s, a) ^ c[i];
      S[j] = s;
      if (s) bad = true;
    }
    return bad ? S : null;
  }

  /** Correct a codeword block in place-copy; null if it has more errors than the code can fix. */
  function rsCorrect(c, nsym) {
    const S = syndromes(c, nsym);
    if (!S) return c;
    const n = c.length;
    // Berlekamp–Massey → error locator C(x)
    let C = [1];
    let B = [1];
    let L = 0;
    let m = 1;
    let b = 1;
    for (let r = 0; r < nsym; r++) {
      let d = S[r];
      for (let i = 1; i <= L; i++) d ^= gmul(C[i] || 0, S[r - i]);
      if (d === 0) { m++; continue; }
      const coef = gdiv(d, b);
      const T = C.slice();
      while (C.length < B.length + m) C.push(0);
      for (let i = 0; i < B.length; i++) C[i + m] ^= gmul(coef, B[i]);
      if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (2 * L > nsym) return null;
    // Chien search: error at power p when C(α^-p) = 0
    const errPos = [];
    for (let p = 0; p < n; p++) {
      const xinv = gpow(-p);
      let v = 0;
      for (let i = C.length - 1; i >= 0; i--) v = gmul(v, xinv) ^ C[i];
      if (v === 0) errPos.push(p);
    }
    if (errPos.length !== L) return null;
    // Forney (first consecutive root α^0)
    const Om = new Array(nsym).fill(0);
    for (let i = 0; i < nsym; i++) for (let j = 0; j < C.length && i + j < nsym; j++) Om[i + j] ^= gmul(S[i], C[j]);
    const out = c.slice();
    for (const p of errPos) {
      const xinv = gpow(-p);
      let om = 0;
      for (let i = nsym - 1; i >= 0; i--) om = gmul(om, xinv) ^ Om[i];
      let dl = 0;
      for (let i = 1; i < C.length; i += 2) dl ^= gmul(C[i], gpow(-p * (i - 1)));
      if (!dl) return null;
      out[n - 1 - p] ^= gmul(gpow(p), gdiv(om, dl));
    }
    return syndromes(out, nsym) ? null : out;
  }

  // ------------------------------------------------------------------ text helpers
  function utf8Encode(s) {
    const out = [];
    for (const ch of s) {
      let cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xC0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else { cp = Math.min(cp, 0x10FFFF); out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)); }
    }
    return out;
  }

  function utf8Decode(arr) {
    let s = '';
    let i = 0;
    while (i < arr.length) {
      const b = arr[i++];
      if (b < 0x80) { s += String.fromCharCode(b); continue; }
      let n;
      let cp;
      if ((b & 0xE0) === 0xC0) { n = 1; cp = b & 0x1F; } else if ((b & 0xF0) === 0xE0) { n = 2; cp = b & 0x0F; } else if ((b & 0xF8) === 0xF0) { n = 3; cp = b & 0x07; } else return null;
      for (let k = 0; k < n; k++) {
        const c = arr[i++];
        if (c === undefined || (c & 0xC0) !== 0x80) return null;
        cp = (cp << 6) | (c & 0x3F);
      }
      if (cp > 0x10FFFF) return null;
      s += String.fromCodePoint(cp);
    }
    return s;
  }

  const latin1 = (arr) => arr.map((b) => String.fromCharCode(b)).join('');

  // ------------------------------------------------------------------ writer
  function pushBits(bits, v, n) { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }

  function segmentBits(seg, ver, bits) {
    const d = seg.data;
    if (seg.mode === 7) {
      pushBits(bits, 7, 4);
      if (d < 128) pushBits(bits, d, 8);
      else if (d < 16384) pushBits(bits, 0x8000 | d, 16);
      else pushBits(bits, 0xC00000 | d, 24);
      return true;
    }
    if (d.length >= (1 << ccBits(seg.mode, ver))) return false;
    pushBits(bits, seg.mode, 4);
    pushBits(bits, d.length, ccBits(seg.mode, ver));
    if (seg.mode === 1) {
      for (let i = 0; i < d.length; i += 3) { const s = d.substr(i, 3); pushBits(bits, parseInt(s, 10), s.length * 3 + 1); }
    } else if (seg.mode === 2) {
      for (let i = 0; i < d.length; i += 2) {
        if (i + 1 < d.length) pushBits(bits, ALNUM.indexOf(d[i]) * 45 + ALNUM.indexOf(d[i + 1]), 11);
        else pushBits(bits, ALNUM.indexOf(d[i]), 6);
      }
    } else if (seg.mode === 8) {
      for (const v of d) pushBits(bits, v, 13);
    } else {
      for (const v of d) pushBits(bits, v & 255, 8);
    }
    return true;
  }

  function penalty(m, n) {
    let p = 0;
    let dark = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < n; a++) {
        let line = '';
        for (let b = 0; b < n; b++) line += pass ? m[b * n + a] : m[a * n + b];
        const runs = line.match(/0{5,}|1{5,}/g);
        if (runs) for (const r of runs) p += r.length - 2;
        for (const pat of ['10111010000', '00001011101']) {
          let i = line.indexOf(pat);
          while (i >= 0) { p += 40; i = line.indexOf(pat, i + 1); }
        }
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = m[y * n + x];
        dark += v;
        if (x < n - 1 && y < n - 1 && v === m[y * n + x + 1] && v === m[(y + 1) * n + x] && v === m[(y + 1) * n + x + 1]) p += 3;
      }
    }
    const total = n * n;
    p += Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  function encodeSegments(segs, ecl = 1, minVersion = 1, boost = true) {
    let ver;
    let bits;
    for (ver = Math.max(1, minVersion); ver <= 40; ver++) {
      bits = [];
      let ok = true;
      for (const s of segs) if (!segmentBits(s, ver, bits)) { ok = false; break; }
      if (ok && bits.length <= dataCodewords(ver, ecl) * 8) break;
    }
    if (ver > 40) throw new Error('Too much data for a QR code');
    if (boost) for (let e = ecl + 1; e <= 3; e++) if (bits.length <= dataCodewords(ver, e) * 8) ecl = e;
    const cap = dataCodewords(ver, ecl) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    for (let pad = 0xEC; data.length < cap / 8; pad ^= 0xEC ^ 0x11) data.push(pad);

    // error correction + interleave
    const L = blockLayout(ver, ecl);
    const gen = rsGenerator(L.ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < L.nb; i++) {
      const len = L.shortData + (i < L.numShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      const ecc = rsRemainder(dat, gen);
      if (i < L.numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) if (i !== L.shortData || j >= L.numShort) cw.push(blocks[j][i]);
    }

    const g = functionGrid(ver);
    const size = g.size;
    const order = zigzag(size, g.fn);
    const base = g.mod.slice();
    for (let i = 0; i < order.length; i++) base[order[i]] = i < cw.length * 8 ? (cw[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
    const [fa, fb] = formatCoords(size);
    let best = null;
    let bestPen = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const mod = base.slice();
      for (const idx of order) if (MASKS[mask](idx % size, (idx / size) | 0)) mod[idx] ^= 1;
      const f = formatBits(ecl, mask);
      for (let i = 0; i < 15; i++) {
        const bit = (f >>> i) & 1;
        mod[fa[i][1] * size + fa[i][0]] = bit;
        mod[fb[i][1] * size + fb[i][0]] = bit;
      }
      const pen = penalty(mod, size);
      if (pen < bestPen) { bestPen = pen; best = { mod, mask }; }
    }
    return { size, version: ver, ecl, eclName: ECL_NAMES[ecl], mask: best.mask, modules: best.mod };
  }

  function encodeText(text, ecl = 1) {
    let seg;
    if (/^[0-9]*$/.test(text)) seg = { mode: 1, data: text };
    else if ([...text].every((c) => ALNUM.includes(c))) seg = { mode: 2, data: text };
    else seg = { mode: 4, data: utf8Encode(text) };
    return encodeSegments([seg], ecl, 1, true);
  }

  function svgPath(qr, border = 4) {
    let d = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (!qr.modules[y * qr.size + x]) continue;
        // merge horizontal runs into one rectangle
        let run = 1;
        while (x + run < qr.size && qr.modules[y * qr.size + x + run]) run++;
        d += `M${x + border} ${y + border}h${run}v1h-${run}z`;
        x += run - 1;
      }
    }
    return { d, dim: qr.size + border * 2 };
  }

  // ------------------------------------------------------------------ reader: image → bits
  function toLuma(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const a = rgba[j + 3];
      const l = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
      g[i] = a === 255 ? l : (l * a + 255 * (255 - a)) / 255; // transparent → white
    }
    return g;
  }

  function binarizeGlobal(g) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < g.length; i++) hist[g[i]]++;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0;
    let wB = 0;
    let best = -1;
    let t = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = g.length - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; t = i; }
    }
    const out = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) out[i] = g[i] <= t ? 1 : 0;
    return out;
  }

  /** Local-threshold binariser (8×8 blocks, 5×5 block neighbourhood), robust to uneven light. */
  function binarizeHybrid(g, w, h) {
    if (w < 40 || h < 40) return binarizeGlobal(g);
    const sw = Math.ceil(w / 8);
    const sh = Math.ceil(h / 8);
    const bp = new Float32Array(sw * sh);
    for (let by = 0; by < sh; by++) {
      const yo = Math.min(by * 8, h - 8);
      for (let bx = 0; bx < sw; bx++) {
        const xo = Math.min(bx * 8, w - 8);
        let sum = 0;
        let mn = 255;
        let mx = 0;
        for (let y = 0; y < 8; y++) {
          const o = (yo + y) * w + xo;
          for (let x = 0; x < 8; x++) {
            const v = g[o + x];
            sum += v;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        let avg = sum / 64;
        if (mx - mn <= 24) {
          avg = mn / 2;
          if (by > 0 && bx > 0) {
            const nb = (bp[(by - 1) * sw + bx] + 2 * bp[by * sw + bx - 1] + bp[(by - 1) * sw + bx - 1]) / 4;
            if (mn < nb) avg = nb;
          }
        }
        bp[by * sw + bx] = avg;
      }
    }
    const out = new Uint8Array(w * h);
    for (let by = 0; by < sh; by++) {
      const yo = Math.min(by * 8, h - 8);
      const top = Math.min(Math.max(by, 2), sh - 3);
      for (let bx = 0; bx < sw; bx++) {
        const xo = Math.min(bx * 8, w - 8);
        const left = Math.min(Math.max(bx, 2), sw - 3);
        let sum = 0;
        for (let z = -2; z <= 2; z++) {
          const r = (top + z) * sw + left;
          sum += bp[r - 2] + bp[r - 1] + bp[r] + bp[r + 1] + bp[r + 2];
        }
        const t = sum / 25;
        for (let y = 0; y < 8; y++) {
          const o = (yo + y) * w + xo;
          for (let x = 0; x < 8; x++) out[o + x] = g[o + x] <= t ? 1 : 0;
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ reader: finder patterns
  function patternOK(s) {
    let total = 0;
    for (let i = 0; i < 5; i++) { if (!s[i]) return false; total += s[i]; }
    if (total < 7) return false;
    const m = total / 7;
    const v = m / 2;
    return Math.abs(m - s[0]) < v && Math.abs(m - s[1]) < v && Math.abs(3 * m - s[2]) < 3 * v
      && Math.abs(m - s[3]) < v && Math.abs(m - s[4]) < v;
  }

  function findFinders(b, w, h) {
    const cands = [];
    // Count a 1:1:3:1:1 cross-section through (fixed, start) along one axis; returns its centre or NaN.
    const cross = (fixed, start, maxCount, origTotal, horizontal) => {
      const limit = horizontal ? w : h;
      const dark = horizontal ? (i) => b[fixed * w + i] === 1 : (i) => b[i * w + fixed] === 1;
      const s = [0, 0, 0, 0, 0];
      let i = start;
      while (i >= 0 && dark(i)) { s[2]++; i--; }
      if (i < 0) return NaN;
      while (i >= 0 && !dark(i) && s[1] <= maxCount) { s[1]++; i--; }
      if (i < 0 || s[1] > maxCount) return NaN;
      while (i >= 0 && dark(i) && s[0] <= maxCount) { s[0]++; i--; }
      if (s[0] > maxCount) return NaN;
      i = start + 1;
      while (i < limit && dark(i)) { s[2]++; i++; }
      if (i === limit) return NaN;
      while (i < limit && !dark(i) && s[3] < maxCount) { s[3]++; i++; }
      if (i === limit || s[3] >= maxCount) return NaN;
      while (i < limit && dark(i) && s[4] < maxCount) { s[4]++; i++; }
      if (s[4] >= maxCount) return NaN;
      const total = s[0] + s[1] + s[2] + s[3] + s[4];
      if (5 * Math.abs(total - origTotal) >= 2 * origTotal) return NaN;
      return patternOK(s) ? i - s[4] - s[3] - s[2] / 2 : NaN;
    };
    const handle = (s, y, x) => {
      const total = s[0] + s[1] + s[2] + s[3] + s[4];
      let cx = x - s[4] - s[3] - s[2] / 2;
      const cy = cross(Math.floor(cx), y, s[2], total, false);
      if (Number.isNaN(cy)) return false;
      cx = cross(Math.floor(cy), Math.floor(cx), s[2], total, true);
      if (Number.isNaN(cx)) return false;
      const ms = total / 7;
      for (const c of cands) {
        if (Math.abs(cy - c.y) <= ms && Math.abs(cx - c.x) <= ms) {
          const d = Math.abs(ms - c.ms);
          if (d <= 1 || d <= c.ms) {
            const n = c.count + 1;
            c.x = (c.x * c.count + cx) / n;
            c.y = (c.y * c.count + cy) / n;
            c.ms = (c.ms * c.count + ms) / n;
            c.count = n;
            return true;
          }
        }
      }
      cands.push({ x: cx, y: cy, ms, count: 1 });
      return true;
    };
    const skip = Math.max(1, Math.floor(h / 300));
    for (let y = skip - 1; y < h; y += skip) {
      let s = [0, 0, 0, 0, 0];
      let st = 0;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (b[row + x]) {
          if (st & 1) st++;
          s[st]++;
        } else if (!(st & 1)) {
          if (st === 4) {
            if (patternOK(s) && handle(s, y, x)) { s = [0, 0, 0, 0, 0]; st = 0; } else { s = [s[2], s[3], s[4], 1, 0]; st = 3; }
          } else { st++; s[st]++; }
        } else s[st]++;
      }
      if (patternOK(s)) handle(s, y, w);
    }
    return cands;
  }

  function findAlignment(b, w, h, ex, ey, ms) {
    const dark = (x, y) => b[y * w + x] === 1;
    const okLen = (n) => n >= ms * 0.5 && n <= ms * 1.7;
    for (const f of [4, 8, 16]) {
      const r = f * ms;
      const x0 = Math.max(0, Math.floor(ex - r));
      const x1 = Math.min(w - 1, Math.ceil(ex + r));
      const y0 = Math.max(0, Math.floor(ey - r));
      const y1 = Math.min(h - 1, Math.ceil(ey + r));
      if (x1 - x0 < ms * 3 || y1 - y0 < ms * 3) continue;
      let best = null;
      let bestD = Infinity;
      for (let y = y0; y <= y1; y++) {
        const runs = [];
        let x = x0;
        while (x <= x1) {
          const c = dark(x, y);
          const s = x;
          while (x <= x1 && dark(x, y) === c) x++;
          runs.push([c, s, x - s]);
        }
        for (let i = 2; i < runs.length - 2; i++) {
          const [c, s, n] = runs[i];
          if (!c || !okLen(n) || !okLen(runs[i - 1][2]) || !okLen(runs[i + 1][2])) continue;
          const cx = s + n / 2;
          const ix = Math.floor(cx);
          let t = y;
          while (t > 0 && dark(ix, t - 1)) t--;
          let bt = y;
          while (bt < h - 1 && dark(ix, bt + 1)) bt++;
          if (!okLen(bt - t + 1)) continue;
          let u = t - 1;
          let lu = 0;
          while (u >= 0 && !dark(ix, u)) { lu++; u--; }
          if (u < 0 || !okLen(lu)) continue;
          let dn = bt + 1;
          let ld = 0;
          while (dn < h && !dark(ix, dn)) { ld++; dn++; }
          if (dn >= h || !okLen(ld)) continue;
          const cy = (t + bt + 1) / 2;
          const dd = (cx - ex) ** 2 + (cy - ey) ** 2;
          if (dd < bestD) { bestD = dd; best = { x: cx, y: cy }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------------ reader: geometry
  /** Perspective transform mapping four src points onto four dst points. */
  function homography(src, dst) {
    const A = [];
    const B = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = src[i];
      const [x, y] = dst[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); B.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); B.push(y);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) < 1e-12) return null;
      [A[c], A[p]] = [A[p], A[c]];
      [B[c], B[p]] = [B[p], B[c]];
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        if (!f) continue;
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        B[r] -= f * B[c];
      }
    }
    const H = B.map((v, i) => v / A[i][i]);
    return (u, v) => {
      const d = H[6] * u + H[7] * v + 1;
      return [(H[0] * u + H[1] * v + H[2]) / d, (H[3] * u + H[4] * v + H[5]) / d];
    };
  }

  function sampleGrid(b, w, h, tl, tr, bl, dim, align) {
    const br = [align.x, align.y];
    const srcBR = align.extrapolated ? [dim - 3.5, dim - 3.5] : [dim - 6.5, dim - 6.5];
    const H = homography([[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], srcBR], [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y], br]);
    if (!H) return null;
    const grid = new Uint8Array(dim * dim);
    let outside = 0;
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const [px, py] = H(x + 0.5, y + 0.5);
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= w || iy >= h) { outside++; continue; }
        grid[y * dim + x] = b[iy * w + ix];
      }
    }
    return outside > dim * 2 ? null : grid;
  }

  function transpose(grid, dim) {
    const t = new Uint8Array(dim * dim);
    for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) t[x * dim + y] = grid[y * dim + x];
    return t;
  }

  function popcount(v) { let c = 0; while (v) { c += v & 1; v >>>= 1; } return c; }

  // ------------------------------------------------------------------ reader: bits → data
  function parseData(bytes, ver) {
    let pos = 0;
    const total = bytes.length * 8;
    const read = (n) => {
      if (pos + n > total) throw new RangeError('short');
      let v = 0;
      for (let i = 0; i < n; i++, pos++) v = (v * 2) + ((bytes[pos >>> 3] >>> (7 - (pos & 7))) & 1);
      return v;
    };
    const segs = [];
    let text = '';
    let eci = null;
    try {
      while (pos + 4 <= total) {
        const mode = read(4);
        if (mode === 0) break;
        if (mode === 1) {
          let left = read(ccBits(1, ver));
          let s = '';
          while (left >= 3) { const v = read(10); if (v > 999) return null; s += String(v).padStart(3, '0'); left -= 3; }
          if (left === 2) { const v = read(7); if (v > 99) return null; s += String(v).padStart(2, '0'); } else if (left === 1) { const v = read(4); if (v > 9) return null; s += String(v); }
          segs.push({ mode: 1, data: s });
          text += s;
        } else if (mode === 2) {
          let left = read(ccBits(2, ver));
          let s = '';
          while (left >= 2) { const v = read(11); if (v >= 45 * 45) return null; s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; left -= 2; }
          if (left === 1) { const v = read(6); if (v >= 45) return null; s += ALNUM[v]; }
          segs.push({ mode: 2, data: s });
          text += s;
        } else if (mode === 4) {
          const n = read(ccBits(4, ver));
          const arr = [];
          for (let i = 0; i < n; i++) arr.push(read(8));
          segs.push({ mode: 4, data: arr });
          const u = eci === 3 || (eci != null && eci !== 26) ? null : utf8Decode(arr);
          text += u != null ? u : latin1(arr);
        } else if (mode === 7) {
          let v = read(8);
          if ((v & 0x80) === 0) { /* one byte */ } else if ((v & 0xC0) === 0x80) v = ((v & 0x3F) << 8) | read(8); else if ((v & 0xE0) === 0xC0) v = ((v & 0x1F) << 16) | read(16); else return null;
          eci = v;
          segs.push({ mode: 7, data: v });
        } else if (mode === 8) {
          const n = read(ccBits(8, ver));
          const arr = [];
          for (let i = 0; i < n; i++) arr.push(read(13));
          segs.push({ mode: 8, data: arr });
          text += '�'.repeat(n);
        } else if (mode === 3) {
          read(16); // structured append header
        } else if (mode === 5) {
          /* FNC1 first position: no payload */
        } else if (mode === 9) {
          read(8);
        } else break;
      }
    } catch (e) {
      if (!segs.length) return null;
    }
    if (!segs.some((s) => s.mode !== 7)) return null;
    return { text, segments: segs };
  }

  function readGrid(grid, dim) {
    const ver = (dim - 17) / 4;
    if (ver < 1 || ver > 40 || ver % 1) return null;
    const [fa, fb] = formatCoords(dim);
    const readF = (co) => { let v = 0; for (let i = 0; i < 15; i++) v |= grid[co[i][1] * dim + co[i][0]] << i; return v; };
    const ra = readF(fa);
    const rb = readF(fb);
    let best = null;
    let bestD = 99;
    for (let e = 0; e < 4; e++) {
      for (let m = 0; m < 8; m++) {
        const f = formatBits(e, m);
        const d = Math.min(popcount(f ^ ra), popcount(f ^ rb));
        if (d < bestD) { bestD = d; best = [e, m]; }
      }
    }
    if (bestD > 3) return null;
    const [ecl, mask] = best;
    const g = functionGrid(ver);
    const order = zigzag(dim, g.fn);
    const L = blockLayout(ver, ecl);
    const raw = new Array(L.raw).fill(0);
    for (let i = 0; i < L.raw * 8; i++) {
      const idx = order[i];
      const bit = grid[idx] ^ (MASKS[mask](idx % dim, (idx / dim) | 0) ? 1 : 0);
      raw[i >>> 3] |= bit << (7 - (i & 7));
    }
    const blocks = [];
    for (let j = 0; j < L.nb; j++) blocks.push(new Array(L.shortLen + 1).fill(0));
    let k = 0;
    for (let i = 0; i <= L.shortLen; i++) {
      for (let j = 0; j < L.nb; j++) {
        if (i === L.shortData && j < L.numShort) continue;
        blocks[j][i] = raw[k++];
      }
    }
    const data = [];
    for (let j = 0; j < L.nb; j++) {
      let blk = blocks[j];
      if (j < L.numShort) blk = blk.slice(0, L.shortData).concat(blk.slice(L.shortData + 1));
      const fixed = rsCorrect(blk, L.ecLen);
      if (!fixed) return null;
      for (let i = 0; i < blk.length - L.ecLen; i++) data.push(fixed[i]);
    }
    const res = parseData(data, ver);
    if (!res) return null;
    res.version = ver;
    res.ecl = ecl;
    res.eclName = ECL_NAMES[ecl];
    res.mask = mask;
    return res;
  }

  function locateAndRead(b, w, h) {
    const cands = findFinders(b, w, h).sort((p, q) => q.count - p.count).slice(0, 12);
    if (cands.length < 3) return null;
    const d2 = (p, q) => (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
    const triples = [];
    for (let i = 0; i < cands.length; i++) {
      for (let j = i + 1; j < cands.length; j++) {
        for (let k = j + 1; k < cands.length; k++) {
          const P = [cands[i], cands[j], cands[k]];
          const sizes = P.map((c) => c.ms);
          if (Math.max(...sizes) / Math.min(...sizes) > 1.6) continue;
          const dAB = d2(P[0], P[1]);
          const dBC = d2(P[1], P[2]);
          const dAC = d2(P[0], P[2]);
          let tl; let o1; let o2; let c2; let a2; let b2;
          if (dBC >= dAB && dBC >= dAC) { tl = P[0]; o1 = P[1]; o2 = P[2]; c2 = dBC; a2 = dAB; b2 = dAC; } else if (dAC >= dAB) { tl = P[1]; o1 = P[0]; o2 = P[2]; c2 = dAC; a2 = dAB; b2 = dBC; } else { tl = P[2]; o1 = P[0]; o2 = P[1]; c2 = dAB; a2 = dAC; b2 = dBC; }
          const ratio = Math.max(a2, b2) / Math.min(a2, b2);
          if (ratio > 2) continue;
          const pyth = Math.abs(c2 - a2 - b2) / c2;
          if (pyth > 0.3) continue;
          const crossZ = (o1.x - tl.x) * (o2.y - tl.y) - (o1.y - tl.y) * (o2.x - tl.x);
          const [tr, bl] = crossZ > 0 ? [o1, o2] : [o2, o1];
          // Finder runs were measured along rows, so a rotated code looks wider: undo that.
          const ang = Math.atan2(tr.y - tl.y, tr.x - tl.x);
          const ms = ((tl.ms + tr.ms + bl.ms) / 3) * Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)));
          const dimEst = (Math.sqrt(d2(tl, tr)) + Math.sqrt(d2(tl, bl))) / 2 / ms + 7;
          if (dimEst < 17 || dimEst > 185) continue;
          triples.push({ tl, tr, bl, ms, dimEst, score: pyth + (ratio - 1) * 0.5 - 0.02 * Math.min(tl.count, tr.count, bl.count, 10) });
        }
      }
    }
    triples.sort((p, q) => p.score - q.score);
    for (const t of triples.slice(0, 6)) {
      let dim = Math.round(t.dimEst);
      switch (dim & 3) { case 0: dim++; break; case 2: dim--; break; case 3: dim += 2; break; default: break; }
      for (const dd of [dim, dim - 4, dim + 4, dim - 8, dim + 8]) {
        if (dd < 21 || dd > 177) continue;
        let align = null;
        if (dd > 21) {
          const brx = t.tr.x - t.tl.x + t.bl.x;
          const bry = t.tr.y - t.tl.y + t.bl.y;
          const corr = 1 - 3 / (dd - 7);
          align = findAlignment(b, w, h, t.tl.x + corr * (brx - t.tl.x), t.tl.y + corr * (bry - t.tl.y), t.ms);
        }
        // No alignment pattern (version 1, or not found): the bottom-right corner is extrapolated, so also
        // try nudging it by half a module in each direction to absorb perspective.
        const tries = [];
        if (align) tries.push(align);
        const brx = t.tr.x - t.tl.x + t.bl.x;
        const bry = t.tr.y - t.tl.y + t.bl.y;
        const step = t.ms * 0.6;
        for (const [ox, oy] of [[0, 0], [1, 1], [-1, -1], [1, -1], [-1, 1], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2], [-2, -2]]) {
          tries.push({ x: brx + ox * step, y: bry + oy * step, extrapolated: true });
        }
        for (const al of tries) {
          const grid = sampleGrid(b, w, h, t.tl, t.tr, t.bl, dd, al);
          if (!grid) continue;
          let r = readGrid(grid, dd);
          if (!r) { r = readGrid(transpose(grid, dd), dd); if (r) r.mirrored = true; }
          if (r) return r;
        }
      }
    }
    return null;
  }

  /** Decode the first QR code found in an ImageData-like { data, width, height }. */
  function decode(img) {
    const w = img.width;
    const h = img.height;
    if (!w || !h) return null;
    const g = toLuma(img.data, w, h);
    for (const bin of [binarizeHybrid, binarizeGlobal]) {
      const b = bin(g, w, h);
      for (let inv = 0; inv < 2; inv++) {
        if (inv) for (let i = 0; i < b.length; i++) b[i] ^= 1; // light-on-dark codes
        const r = locateAndRead(b, w, h);
        if (r) return r;
      }
    }
    return null;
  }

  root.PPQR = { decode, encodeSegments, encodeText, svgPath, ECL_NAMES };
})(typeof window !== 'undefined' ? window : globalThis);
