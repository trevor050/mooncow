// Renders assets/icon.svg to the PNG sizes WXT picks up from public/icon/.
//   node scripts/render-icons.mjs
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const svg = fs.readFileSync('assets/icon.svg', 'utf8');
fs.mkdirSync('public/icon', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 96, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
}
await browser.close();
console.log('wrote public/icon/{16,32,48,96,128}.png');
