// Captures the README screenshots and demo GIF from the built Chromium
// package, with a scripted set of local tabs and a mock AI endpoint.
//   npm run build:chrome && node scripts/screenshots.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ext = path.resolve('.output/chrome-mv3');
const out = path.resolve('docs/screenshots');
fs.mkdirSync(out, { recursive: true });
const videoDir = fs.mkdtempSync(path.resolve('.output/video-'));

const letterIcon = (letter, color) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/><text x="16" y="22" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text></svg>`)}`;

const PAGES = {
  '/': { title: 'The best ramen in Boston, ranked', icon: letterIcon('R', '#c2410c'), body: '<h1>The best ramen in Boston, ranked</h1><p>Tonkotsu, shoyu and miso, from twelve bowls eaten over one very cold week. The broth at the top of this list simmers for eighteen hours; the one at the bottom tastes like it simmered for eighteen minutes.</p><p>We judged on broth, noodles, chashu and the egg. Price and wait time were tie-breakers, not deal-breakers.</p>' },
  '/pr': { title: 'Rebuild the bar on WXT · Pull Request #42 · trevor050/mooncow', icon: letterIcon('G', '#24292f'), body: '<h1>Rebuild the bar on WXT</h1>' },
  '/design': { title: 'MoonCow bar – design review', icon: letterIcon('F', '#7c3aed'), body: '<h1>Design review</h1>' },
  '/docs': { title: 'Content Scripts – WXT', icon: letterIcon('W', '#16a34a'), body: '<h1>Content Scripts</h1>' },
  '/inbox': { title: 'Inbox (3) – Mail', icon: letterIcon('M', '#2563eb'), body: '<h1>Inbox</h1>' },
  '/issue': { title: 'MOO-118 Rank open tabs above suggestions', icon: letterIcon('L', '#5b5bd6'), body: '<h1>MOO-118</h1>' },
  '/moon': { title: 'Moon phases this month – Almanac', icon: letterIcon('A', '#0f766e'), body: '<h1>Moon phases</h1>' },
};

const ANSWER = `A **tonkotsu** broth is made by boiling pork bones hard for many hours, which emulsifies fat and collagen into a creamy, opaque soup.

- **Bones:** trotters and femurs, blanched first
- **Time:** 12–18 hours at a rolling boil
- **Finish:** a salty *tare* and aroma oil in the bowl

\`\`\`
broth : tare ≈ 10 : 1
\`\`\``;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/v1/chat/completions')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();
    req.resume();
    req.on('end', async () => {
      res.setHeader('Content-Type', 'text/event-stream');
      for (const piece of ANSWER.match(/[\s\S]{1,12}/g)) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 25));
      }
      res.end('data: [DONE]\n\n');
    });
    return;
  }
  const p = PAGES[req.url.split('?')[0]] || PAGES['/'];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><title>${p.title}</title><link rel="icon" href="${p.icon}"></head><body style="margin:0;font:17px/1.6 Georgia,serif;color:#222;background:#fbfaf7"><div style="max-width:720px;margin:0 auto;padding:56px 32px">${p.body}</div></body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

async function session(scheme, { video = false } = {}) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    colorScheme: scheme,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    ...(video ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } } } : {}),
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  await worker.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({ settings: { theme: 'system', suggestions: false, newTabPage: true, ai: { baseUrl, apiKey: 'demo', model: 'gpt-6-luna', reasoningEffort: '' } } });
  }, `${base}/v1`);
  for (const p of ['/inbox', '/pr', '/design', '/docs', '/issue', '/moon']) {
    const tab = await context.newPage();
    await tab.goto(base + p);
  }
  const page = await context.newPage();
  await page.goto(base + '/');
  await page.waitForTimeout(300);
  return { context, page, id };
}

async function overlay(page) {
  await page.keyboard.press('Control+e');
  for (let i = 0; i < 50; i++) {
    const f = page.frames().find((x) => x.url().includes('/palette.html'));
    if (f && (await f.locator('.query').isVisible().catch(() => false))) return f;
    await page.waitForTimeout(100);
  }
  throw new Error('no palette');
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const shot = (page, name) => page.screenshot({ path: path.join(out, name) });

for (const scheme of ['light', 'dark']) {
  const { context, page, id } = await session(scheme);
  const frame = await overlay(page);
  await frame.locator('.query').fill('moon');
  await page.waitForTimeout(700);
  await shot(page, `tabs-${scheme}.png`);

  if (scheme === 'dark') {
    await frame.locator('.query').press(`${MOD}+k`);
    await page.waitForTimeout(250);
    await shot(page, 'actions-dark.png');
    await frame.locator('.menu').press('Escape');
  } else {
    await frame.locator('.query').fill('#5b5bd6');
    await page.waitForTimeout(300);
    await frame.locator('.query').press(`${MOD}+Enter`);
    await page.waitForTimeout(300);
    await shot(page, 'color-light.png');
    await frame.locator('.color-view input.field').press('Escape');
    await frame.locator('.query').fill('ai how is tonkotsu broth made');
    await page.waitForTimeout(300);
    await frame.locator('.query').press('Enter');
    await frame.locator('.msg.assistant pre').waitFor();
    await page.waitForTimeout(300);
    await shot(page, 'chat-light.png');
  }

  const ntp = await context.newPage();
  await ntp.goto(`chrome-extension://${id}/newtab.html`);
  await ntp.locator('.query').click();
  await ntp.locator('.query').fill('days until christmas');
  await ntp.waitForTimeout(400);
  await ntp.screenshot({ path: path.join(out, `newtab-${scheme}.png`) });
  await context.close();
}

// Demo GIF: real typing, recorded from the page.
{
  const { context, page } = await session('light', { video: true });
  const frame = await overlay(page);
  const type = async (text, hold = 1100) => {
    await frame.locator('.query').fill('');
    await frame.locator('.query').pressSequentially(text, { delay: 55 });
    await page.waitForTimeout(hold);
  };
  await page.waitForTimeout(400);
  await type('moon');
  await type('10 km to mi');
  await type('#5b5bd6');
  await type('sha256 hello', 1300);
  await type('3pm est in tokyo');
  await type('days until christmas');
  await type('> close', 1400);
  await type('pull');
  const video = page.video();
  await context.close();
  const webm = await video.path();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf',
    'crop=820:560:230:70,fps=12,scale=820:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
    path.join(out, 'demo.gif')]);
}

fs.rmSync(videoDir, { recursive: true, force: true });
server.close();
console.log('screenshots written to', out);
