/**
 * Writes a simple branded PNG (and ICO) under build/ for Electron + NSIS.
 * No external image tools required.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "build");
mkdirSync(outDir, { recursive: true });

const SIZE = 256;

/** Deep teal background with a light "H" mark. */
function pixel(x, y) {
  const bg = [15, 76, 92, 255]; // #0f4c5c
  const fg = [232, 241, 242, 255]; // #e8f1f2
  const n = SIZE;
  const margin = Math.floor(n * 0.18);
  const bar = Math.floor(n * 0.14);
  const crossTop = Math.floor(n * 0.42);
  const crossBot = Math.floor(n * 0.58);
  const inLeft = x >= margin && x < margin + bar;
  const inRight = x >= n - margin - bar && x < n - margin;
  const inCross = y >= crossTop && y < crossBot && x >= margin && x < n - margin;
  const inStem = y >= margin && y < n - margin && (inLeft || inRight);
  if (inStem || inCross) return fg;
  return bg;
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(
        Math.floor((x * SIZE) / size),
        Math.floor((y * SIZE) / size),
      );
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * ICO with embedded PNG images. Width/height byte 0 means 256.
 * electron-builder requires at least one >= 256px image.
 */
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  const bodies = [];
  for (const { size, png } of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(0, 2);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    bodies.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...bodies]);
}

const png256 = encodePng(256);
const png48 = encodePng(48);
const png32 = encodePng(32);
writeFileSync(join(outDir, "icon.png"), png256);
writeFileSync(
  join(outDir, "icon.ico"),
  encodeIco([
    { size: 256, png: png256 },
    { size: 48, png: png48 },
    { size: 32, png: png32 },
  ]),
);
console.log("Wrote build/icon.png and build/icon.ico");
