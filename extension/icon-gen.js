// Generates the extension's arc-reactor-style icons (16/48/128px) as raw PNGs.
// No image libraries available in this build image, so we encode PNG bytes by hand:
// signature + IHDR + IDAT(zlib-deflated raw RGBA scanlines) + IEND.
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Dark HUD backdrop with a glowing cyan arc-reactor ring + core, Jarvis-style.
function drawArcReactor(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.46;
  const ringInner = size * 0.30;
  const coreR = size * 0.14;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;

      let r = 4, g = 12, b = 16, a = 255; // near-black HUD backdrop

      if (dist <= outerR) {
        if (dist >= ringInner) {
          // outer glowing ring, brighter near its inner edge
          const t = 1 - (dist - ringInner) / (outerR - ringInner);
          r = Math.round(20 + 60 * t);
          g = Math.round(180 + 60 * t);
          b = Math.round(210 + 45 * t);
        } else if (dist <= coreR) {
          // bright core
          r = 210;
          g = 245;
          b = 255;
        } else {
          // gap between core and ring: subtle glow falloff
          const t = (dist - coreR) / (ringInner - coreR);
          const glow = 1 - t;
          r = Math.round(6 + 40 * glow);
          g = Math.round(30 + 90 * glow);
          b = Math.round(38 + 100 * glow);
        }
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = a;
    }
  }
  return rgba;
}

function generateIcons(outFile128, outFile48, outFile16, fs, path) {
  const sizes = [
    [128, outFile128],
    [48, outFile48],
    [16, outFile16]
  ];
  for (const [size, dest] of sizes) {
    const png = encodePNG(size, size, drawArcReactor(size));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, png);
  }
}

module.exports = { generateIcons };
