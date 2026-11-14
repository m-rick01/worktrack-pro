// Generates the app icons from public/img/logo.png.
//
//   node scripts/make-icons.js
//
// Run it again if the logo changes; the icons it writes are committed, so the
// app itself never does this work. PNG is read and written here by hand on top
// of node:zlib, for the same reason there is no image library anywhere else in
// this project: it would be the only dependency.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const IMG_DIR = path.join(__dirname, '..', 'public', 'img');
const SOURCE = path.join(IMG_DIR, 'logo.png');

// ---------- PNG reading ----------

function readPng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colourType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || colourType !== 6 || interlace !== 0) {
    throw new Error(`only 8-bit RGBA, non-interlaced PNG is supported (got depth ${bitDepth}, type ${colourType}, interlace ${interlace})`);
  }

  // Collect the image data, which may be split across several IDAT chunks.
  const parts = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const pixels = Buffer.alloc(width * height * 4);
  const stride = width * 4;
  let pos = 0;

  // Undo the per-scanline filter. Each line is prefixed with its filter type.
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? out[x - 4] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= 4 ? prev[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        // Paeth: pick whichever neighbour the gradient points at.
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[x] = value & 0xff;
    }
  }

  return { width, height, pixels };
}

// ---------- PNG writing ----------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function writePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Filter 0 on every line: these are small, flat images and compress fine.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- composing ----------

// Returns a view of the source limited to a rectangle, so an icon can use the
// mark on its own. The full lockup includes "Laboratoire dentaire", which is
// illegible once it is scaled to a 192px home-screen tile.
function crop(src, x0, y0, x1, y1) {
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    src.pixels.copy(
      pixels,
      y * width * 4,
      ((y0 + y) * src.width + x0) * 4,
      ((y0 + y) * src.width + x1) * 4
    );
  }
  return { width, height, pixels };
}

// Makes a rectangle fully transparent, returning a new image.
function eraseRegion(src, x0, y0, x1, y1) {
  const pixels = Buffer.from(src.pixels);
  for (let y = y0; y < Math.min(y1, src.height); y++) {
    for (let x = x0; x < Math.min(x1, src.width); x++) pixels[(y * src.width + x) * 4 + 3] = 0;
  }
  return { width: src.width, height: src.height, pixels };
}

// Crops to the bounding box of whatever is visible, so the mark is scaled by its
// own size rather than by the empty space around it in the artwork.
function trimToInk(src, threshold = 8) {
  let minX = src.width, minY = src.height, maxX = -1, maxY = -1;
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      if (src.pixels[(y * src.width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return crop(src, minX, minY, maxX + 1, maxY + 1);
}

// The artwork is the tooth mark with "Orthoclic / Laboratoire dentaire" set
// inside its opening. At home-screen size that lettering is unreadable, so the
// icon uses the tooth alone. These bounds were measured from logo.png: the
// lettering occupies rows 186-266 from x=200 rightwards, and the tooth's own
// strokes (swoosh above, foot below, left wall) all lie clear of that box.
// Re-measure them if the logo is ever replaced.
const LETTERING_BOX = [200, 186, 700, 266];

function toothMark(src) {
  return trimToInk(eraseRegion(src, ...LETTERING_BOX));
}

// Draws the source scaled to fit `contentFraction` of a square canvas, centred,
// over a solid background. Box-samples so downscaling stays smooth.
function makeIcon(src, size, contentFraction, background) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = background[0];
    canvas[i * 4 + 1] = background[1];
    canvas[i * 4 + 2] = background[2];
    canvas[i * 4 + 3] = 255;
  }

  const maxContent = Math.round(size * contentFraction);
  const scale = Math.min(maxContent / src.width, maxContent / src.height);
  const drawW = Math.max(1, Math.round(src.width * scale));
  const drawH = Math.max(1, Math.round(src.height * scale));
  const offsetX = Math.round((size - drawW) / 2);
  const offsetY = Math.round((size - drawH) / 2);

  for (let y = 0; y < drawH; y++) {
    for (let x = 0; x < drawW; x++) {
      // Average the source pixels this destination pixel covers.
      const sx0 = Math.floor((x * src.width) / drawW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.width) / drawW));
      const sy0 = Math.floor((y * src.height) / drawH);
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.height) / drawH));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          const alpha = src.pixels[i + 3] / 255;
          // Weight colour by alpha so transparent edges don't drag in black.
          r += src.pixels[i] * alpha;
          g += src.pixels[i + 1] * alpha;
          b += src.pixels[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const cover = a / n;
      if (cover <= 0) continue;
      const di = ((offsetY + y) * size + offsetX + x) * 4;
      // Composite over the background.
      canvas[di] = Math.round((r / a) * cover + background[0] * (1 - cover));
      canvas[di + 1] = Math.round((g / a) * cover + background[1] * (1 - cover));
      canvas[di + 2] = Math.round((b / a) * cover + background[2] * (1 - cover));
      canvas[di + 3] = 255;
    }
  }

  return writePng(size, size, canvas);
}

// ---------- run ----------

module.exports = { readPng, writePng, crop, eraseRegion, trimToInk, toothMark, makeIcon };

if (require.main === module) {
  const logo = readPng(fs.readFileSync(SOURCE));
  const source = toothMark(logo);
  console.log(`source: logo.png ${logo.width}x${logo.height}, tooth mark ${source.width}x${source.height}`);

  const WHITE = [255, 255, 255];
  const targets = [
    // Plain icons: the mark nearly fills the tile.
    ['icon-192.png', 192, 0.74, WHITE],
    ['icon-512.png', 512, 0.74, WHITE],
    // Maskable: Android crops towards a circle, so everything that matters has
    // to sit inside the middle 80%. Keep the mark well within that.
    ['icon-maskable-512.png', 512, 0.56, WHITE],
  ];

  for (const [name, size, fraction, background] of targets) {
    const png = makeIcon(source, size, fraction, background);
    fs.writeFileSync(path.join(IMG_DIR, name), png);
    console.log(`  wrote ${name}  ${size}x${size}  ${png.length} bytes`);
  }
}
