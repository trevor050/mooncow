// Real-Firefox smoke test. Playwright cannot load extensions into Firefox, so
// this uses Puppeteer over WebDriver BiDi, which can (browser.installExtension).
//
//   npm run build:firefox && node e2e/firefox-smoke.mjs
//
// Set FIREFOX_BIN to choose the binary (defaults to /Applications/Firefox.app
// on macOS, `firefox` on PATH elsewhere). SHOTS=dir saves screenshots.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const root = path.resolve('.output/firefox-mv3');
const bin =
  process.env.FIREFOX_BIN ||
  (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
const shots = process.env.SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const pages = {
  '/': '<!doctype html><title>Ramen guide</title><h1>Best ramen</h1><p>Tonkotsu is a pork bone broth.</p>',
  '/docs': '<!doctype html><title>WXT docs</title><h1>WXT</h1>',
  // A page that tries hard to break injected UI: hides iframes and unknown
  // elements, resets everything in body, and stacks its own overlay on top.
  '/hostile': `<!doctype html><title>Hostile CSS</title><style>
    iframe, mooncow-palette, :not(html):not(head):not(body):not(p):not(style):not(div) { display: none !important; opacity: 0 !important; }
    body * { all: unset !important; }
    div.cover { position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; background: red !important; display: block !important; }
  </style><p>nothing to see</p><div class="cover"></div>`,
};
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(pages[req.url] || pages['/']);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ browser: 'firefox', executablePath: bin, headless: process.env.HEADFUL ? false : true });
try {
  await browser.installExtension(root);
  const other = await browser.newPage();
  await other.goto(`${base}/docs`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 800 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/`);
  await sleep(500);

  async function paletteFrame() {
    for (const f of page.frames()) {
      try {
        if (await f.evaluate(() => !!document.querySelector('.query'))) return f;
      } catch {}
    }
    return null;
  }
  async function openPalette() {
    await page.keyboard.down('Control');
    await page.keyboard.press('e');
    await page.keyboard.up('Control');
    for (let i = 0; i < 30; i++) {
      const f = await paletteFrame();
      if (f && (await f.evaluate(() => document.activeElement?.classList.contains('query')))) return f;
      await sleep(100);
    }
    return paletteFrame();
  }
  async function query(frame, text, wait = 900) {
    await frame.evaluate((t) => {
      const input = document.querySelector('.query');
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(wait);
    return frame.evaluate(() =>
      [...document.querySelectorAll('.results .row')].map((r) => ({
        title: r.querySelector('.title, .label')?.textContent || '',
        answer: r.querySelector('.answer')?.textContent || '',
        sub: r.querySelector('.subtitle')?.textContent || '',
        kind: [...r.classList].find((c) => c.startsWith('kind-'))?.slice(5),
      })),
    );
  }

  const t0 = Date.now();
  const frame = await openPalette();
  check('palette opens on Ctrl+E and focuses the input', !!frame, `${Date.now() - t0} ms`);
  if (!frame) throw new Error('no palette');

  let rows = await query(frame, '2+2*3');
  check('calculator', rows[0]?.answer === '8', JSON.stringify(rows[0]));
  rows = await query(frame, '#ff8800');
  check('color parses six-digit hex', rows[0]?.title === '#FF8800', rows[0]?.title);
  rows = await query(frame, '10 km to mi');
  check('unit conversion', rows[0]?.answer === '6.2137 mi', rows[0]?.answer);
  rows = await query(frame, 'back to the future');
  check('"back to the future" does not trigger Go back', !rows.some((r) => r.title === 'Go back'), rows.map((r) => r.title).join(' | '));
  rows = await query(frame, 'sha256 abc', 1200);
  check('real SHA-256', rows[0]?.answer === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', rows[0]?.answer);
  rows = await query(frame, '5x + 3 = 8', 2500);
  check('algebra via lazily loaded nerdamer', rows[0]?.answer === 'x = 1', rows[0]?.answer);
  rows = await query(frame, 'wxt');
  check('open tab ranks first', rows[0]?.kind === 'tab' && rows[0]?.title === 'WXT docs', JSON.stringify(rows[0]));
  rows = await query(frame, '>');
  check('">" lists every command', rows.length >= 20 && rows.every((r) => r.kind === 'command'), `${rows.length} rows`);
  rows = await query(frame, '25 usd to eur', 3000);
  check('currency hydrates from Frankfurter', /€/.test(rows[0]?.answer || ''), rows[0]?.answer);
  if (shots) {
    await query(frame, 'gml');
    await page.screenshot({ path: path.join(shots, 'firefox-palette.png') });
  }

  // Esc closes and returns focus to the page.
  await frame.focus('.query');
  await page.keyboard.press('Escape');
  await sleep(300);
  const hidden = await page.evaluate(() => getComputedStyle(document.querySelector('mooncow-palette')).display === 'none');
  check('Esc closes the palette', hidden);

  // Hostile page CSS cannot hide or restyle the palette.
  await page.goto(`${base}/hostile`);
  await sleep(500);
  const hostile = await openPalette();
  const visible = hostile && (await page.evaluate(() => {
    const el = document.querySelector('mooncow-palette');
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).display !== 'none' && r.width > 100 && r.height > 100;
  }));
  check('palette survives hostile page CSS', !!visible);
  if (hostile) {
    const style = await hostile.evaluate(() => getComputedStyle(document.querySelector('.panel')).borderRadius);
    check('panel styles are isolated from the page', style !== '0px', style);
  }

  check('no page errors', errors.length === 0, errors.join('; '));
} finally {
  await browser.close();
  server.close();
}
if (failures) {
  console.error(`${failures} Firefox check(s) failed`);
  process.exit(1);
}
console.log('Firefox smoke passed');
