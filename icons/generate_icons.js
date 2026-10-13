// Regenerates the Chrome toolbar icons using only Node's built-in modules.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT = __dirname;
const SS = 4;
const S = 128 * SS;
const pixels = Buffer.alloc(S * S * 4);

function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const qx = Math.abs(x - cx) - ((right - left) / 2 - radius);
  const qy = Math.abs(y - cy) - ((bottom - top) / 2 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function segmentDistance(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    const x = (px + 0.5) / SS, y = (py + 0.5) / SS;
    const idx = (py * S + px) * 4;
    const card = roundedRectDistance(x, y, 5, 5, 123, 123, 29);
    if (card <= 0) {
      const t = Math.max(0, Math.min(1, y / 128));
      pixels[idx] = Math.round(8 + 4 * t);
      pixels[idx + 1] = Math.round(16 + 7 * t);
      pixels[idx + 2] = Math.round(30 + 11 * t);
      pixels[idx + 3] = 255;
      if (card > -1.4) {
        pixels[idx] = 25; pixels[idx + 1] = 76; pixels[idx + 2] = 93;
      }
    }
    // A crisp, two-tone V monogram.
    const left = segmentDistance(x, y, 31, 30, 63, 98);
    const right = segmentDistance(x, y, 63, 98, 97, 30);
    const d = Math.min(left, right);
    if (d < 13) {
      const blend = Math.max(0, Math.min(1, (x - 55) / 25));
      const coverage = Math.max(0, Math.min(1, 13 - d));
      const c = [Math.round(34 * (1 - blend) + 251 * blend), Math.round(211 * (1 - blend) + 146 * blend), Math.round(238 * (1 - blend) + 60 * blend)];
      const alpha = coverage * 255;
      for (let i = 0; i < 3; i++) pixels[idx + i] = Math.round(c[i] * coverage + pixels[idx + i] * (1 - coverage));
      pixels[idx + 3] = Math.max(pixels[idx + 3], alpha);
    }
  }
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const sourceY = Math.min(S - 1, Math.floor((y + (sy + 0.5) / SS) * S / size));
        const sourceX = Math.min(S - 1, Math.floor((x + (sx + 0.5) / SS) * S / size));
        const i = (sourceY * S + sourceX) * 4;
        r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; a += pixels[i + 3];
      }
      const target = row + 1 + x * 4;
      raw[target] = Math.round(r / (SS * SS));
      raw[target + 1] = Math.round(g / (SS * SS));
      raw[target + 2] = Math.round(b / (SS * SS));
      raw[target + 3] = Math.round(a / (SS * SS));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) fs.writeFileSync(path.join(OUT, `icon${size}.png`), createPng(size));
