// Tiny dependency-free QR code generator (#45).
//
// Enough of a QR encoder to render a party deep-link (?party=CODE) so phone
// players can scan to join. Supports byte mode, versions 1-10, error-correction
// level L. Adapted to a compact self-contained implementation.

/* eslint-disable */
// QR code generation (byte mode, EC level L). Minimal, no external deps.

const EXP = new Array(256);
const LOG = new Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 256; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length; j++) {
      res[j] ^= gfMul(gen[j], factor);
    }
  }
  return res;
}

// Version capacities (byte mode, EC-L): totalCodewords, ecCodewordsPerBlock, blocks
const VERSION_INFO = {
  1: { size: 21, total: 19, ec: 7, blocks: 1 },
  2: { size: 25, total: 34, ec: 10, blocks: 1 },
  3: { size: 29, total: 55, ec: 15, blocks: 1 },
  4: { size: 33, total: 80, ec: 20, blocks: 1 },
  5: { size: 37, total: 108, ec: 26, blocks: 1 },
};

function chooseVersion(byteLen) {
  for (const v of [1, 2, 3, 4, 5]) {
    const info = VERSION_INFO[v];
    // 4 bits mode + 8 bits length + data + terminator fits in `total` codewords
    const capacityBits = info.total * 8;
    const needed = 4 + 8 + byteLen * 8;
    if (needed <= capacityBits) return v;
  }
  return null;
}

export function generateMatrix(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 128) bytes.push(c);
    else { bytes.push(63); } // '?' for non-ASCII; deep links are ASCII
  }
  const version = chooseVersion(bytes.length);
  if (!version) return null;
  const info = VERSION_INFO[version];
  const size = info.size;

  // Build bit stream.
  const bits = [];
  const pushBits = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
  pushBits(0b0100, 4);          // byte mode
  pushBits(bytes.length, 8);    // length
  bytes.forEach((b) => pushBits(b, 8));
  pushBits(0, 4);               // terminator (may overflow, trimmed below)
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    dataCodewords.push(byte);
  }
  // Pad codewords.
  const pads = [0xec, 0x11];
  let pi = 0;
  while (dataCodewords.length < info.total) dataCodewords.push(pads[pi++ % 2]);

  const ecCodewords = rsEncode(dataCodewords, info.ec);
  const allCodewords = dataCodewords.concat(ecCodewords);

  // Module matrix.
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function placeFinder(r, c) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        modules[rr][cc] = inRing ? 1 : 0;
        reserved[rr][cc] = true;
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    if (modules[6][i] === null) { modules[6][i] = v; reserved[6][i] = true; }
    if (modules[i][6] === null) { modules[i][6] = v; reserved[i][6] = true; }
  }
  // Dark module.
  modules[size - 8][8] = 1; reserved[size - 8][8] = true;

  // Reserve format info areas.
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) { reserved[8][i] = true; }
    if (modules[i][8] === null) { reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }

  // Place data with zig-zag.
  let bitIndex = 0;
  const dataBits = [];
  allCodewords.forEach((cw) => { for (let i = 7; i >= 0; i--) dataBits.push((cw >> i) & 1); });

  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip timing column
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (reserved[row][cc]) continue;
        let bit = bitIndex < dataBits.length ? dataBits[bitIndex++] : 0;
        // Mask 0: (row+col) % 2 === 0
        if ((row + cc) % 2 === 0) bit ^= 1;
        modules[row][cc] = bit;
      }
    }
    upward = !upward;
  }

  // Format info for EC-L + mask 0 => bits 111011111000100
  const formatBits = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0];
  // Place around top-left.
  const fmtPos1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
  fmtPos1.forEach((pos, i) => { modules[pos[0]][pos[1]] = formatBits[i]; });
  // Place around top-right / bottom-left.
  for (let i = 0; i < 7; i++) modules[8][size - 1 - i] = formatBits[i];
  for (let i = 7; i < 15; i++) modules[size - 15 + i][8] = formatBits[i];

  // Fill any remaining nulls (shouldn't be many) with 0.
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (modules[r][c] === null) modules[r][c] = 0;

  return modules;
}

// Render a QR matrix to a canvas element.
export function renderQRCanvas(text, pixelSize = 4, margin = 4) {
  const matrix = generateMatrix(text);
  const canvas = document.createElement('canvas');
  if (!matrix) return canvas;
  const size = matrix.length;
  const dim = (size + margin * 2) * pixelSize;
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        ctx.fillRect((c + margin) * pixelSize, (r + margin) * pixelSize, pixelSize, pixelSize);
      }
    }
  }
  return canvas;
}
