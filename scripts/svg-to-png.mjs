// public/branding/*.svg 를 토스 규격 PNG로 변환.
// 결과: public/branding/logo.png (600x600), public/branding/thumbnail.png (1932x828)
//
// 사용:  npm i -D sharp 후
//        node scripts/svg-to-png.mjs

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const branding = resolve(__dirname, "..", "public", "branding");

const jobs = [
  { svg: "logo.svg", png: "logo.png", w: 600, h: 600 },
  { svg: "thumbnail.svg", png: "thumbnail.png", w: 1932, h: 828 },
];

for (const { svg, png, w, h } of jobs) {
  const inPath = resolve(branding, svg);
  const outPath = resolve(branding, png);
  const buf = await readFile(inPath);
  const out = await sharp(buf, { density: 320 })
    .resize(w, h)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(outPath, out);
  console.log(`✓ ${svg} → ${png} (${w}x${h})`);
}
