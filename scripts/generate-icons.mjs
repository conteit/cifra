/**
 * Rasterises public/icons/icon.svg into the PWA icon sizes declared in
 * vite.config.ts. The SVG is the source of truth; the PNGs are build artefacts
 * that happen to be committed, because the manifest needs real files.
 *
 *   node scripts/generate-icons.mjs
 *
 * Uses the Chromium that Playwright already installs for e2e and the Storybook
 * story tests, so there is no extra rasteriser dependency to keep pinned.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public/icons/icon.svg');
const outDir = resolve(root, 'public/icons');
const sizes = [192, 512];

const svg = await readFile(source, 'utf8');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  for (const size of sizes) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><style>
         html,body{margin:0;padding:0;width:${size}px;height:${size}px}
         svg{display:block;width:${size}px;height:${size}px}
       </style>${svg}`,
      { waitUntil: 'load' },
    );
    await page.screenshot({ path: resolve(outDir, `icon-${size}.png`) });
    await page.close();
    console.log(`wrote public/icons/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
