// Deterministic texture normalization; run in Docker after generation. Keeps original files.
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.goto('http://localhost:5173/');
const source = await fs.readFile('assets/sources/oaxaca-tree.png');
const result = await page.evaluate(
  async (dataUrl) => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height),
      d = pixels.data;
    let left = canvas.width,
      top = canvas.height,
      right = 0,
      bottom = 0;
    for (let i = 0; i < d.length; i += 4) {
      const paper = Math.min(d[i], d[i + 1], d[i + 2]) / 255;
      const a = Math.max(0, Math.min(1, (0.98 - paper) / 0.24));
      for (let c = 0; c < 3; c++)
        d[i + c] = a > 0.01 ? Math.max(0, Math.min(255, (d[i + c] - 255 * (1 - a)) / a)) : 0;
      d[i + 3] = Math.round(a * 255);
      if (a > 0.5) {
        const x = (i / 4) % canvas.width,
          y = Math.floor(i / 4 / canvas.width);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    ctx.putImageData(pixels, 0, 0);
    const output = document.createElement('canvas');
    const w = right - left + 1,
      h = bottom - top + 1;
    output.width = 1536;
    output.height = Math.round((1536 * h) / w);
    output.getContext('2d').drawImage(canvas, left, top, w, h, 0, 0, output.width, output.height);
    return {
      data: output.toDataURL('image/webp', 0.92).split(',')[1],
      width: output.width,
      height: output.height,
    };
  },
  `data:image/png;base64,${source.toString('base64')}`,
);
const bytes = Buffer.from(result.data, 'base64');
await fs.writeFile('public/assets/oaxaca-tree.webp', bytes);
await fs.writeFile(
  'assets/receipts/tree-normalization.json',
  JSON.stringify(
    {
      source: 'assets/sources/oaxaca-tree.png',
      output: 'public/assets/oaxaca-tree.webp',
      operation: 'White matte removal, color decontamination, alpha-bounds crop, 1536px WebP',
      width: result.width,
      height: result.height,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  ),
);
console.log(`Tree texture prepared: ${result.width} x ${result.height}, ${bytes.length} bytes`);
await browser.close();
