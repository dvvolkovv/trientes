// Знак для капчи = глиф из public/logo.png без круглой подложки.
// Маска CSS читает альфу, поэтому полупрозрачный круг пришлось бы вырезать
// порогом: всё, что ниже 200, — фон.
import sharp from "sharp";

const THRESHOLD = 200;

async function main() {
  const src = sharp("public/logo.png");
  const { width, height } = await src.metadata();
  if (!width || !height) throw new Error("no size");
  const { data } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    const keep = a >= THRESHOLD;
    out[i * 4] = 255;
    out[i * 4 + 1] = 255;
    out[i * 4 + 2] = 255;
    out[i * 4 + 3] = keep ? 255 : 0;
    if (keep) {
      const x = i % width;
      const y = Math.floor(i / width);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("empty glyph");
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  await sharp(out, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: w, height: h })
    .png()
    .toFile("public/captcha-mark.png");
  console.log("captcha-mark", w, "x", h, "ratio", (w / h).toFixed(3));
}

void main();
