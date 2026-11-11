import { chromium, test as base, type BrowserContext, type Frame, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

const extensionPath = path.resolve('.output/chrome-mv3');

/** Local pages with realistic titles, plus a fake OpenAI-compatible endpoint. */
function startServer() {
  const pages: Record<string, string> = {
    '/': 'Ramen in Boston: the 12 best bowls',
    '/gmail': 'Inbox (3) - you@example.com - Gmail',
    '/pr': 'Rebuild the palette on WXT by trevor050 · Pull Request #42 · mooncow',
    '/docs': 'Content Scripts – WXT',
    '/figma': 'MoonCow bar – Figma',
    '/linear': 'MOO-118 Rank open tabs above suggestions – Linear',
  };
  let cancelledStreams = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/slow/v1/chat/completions') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') return res.end();
      req.resume();
      res.setHeader('Content-Type', 'text/event-stream');
      const timer = setInterval(() => res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'streaming ' } }] })}\n\n`), 100);
      res.on('close', () => { clearInterval(timer); cancelledStreams++; });
      return;
    }
    if (req.url?.startsWith('/v1/chat/completions')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') return res.end();
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        const last = parsed.messages.at(-1).content as string;
        res.setHeader('Content-Type', 'text/event-stream');
        const words = `**Short answer:** you asked “${last}”. Model was ${parsed.model}.`.split(' ');
        for (const w of words) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w + ' ' } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
      return;
    }
    const key = (req.url || '/').split('?')[0];
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><title>${pages[key] || 'Page'}</title><body style="font:16px system-ui;padding:40px;max-width:720px"><h1>${pages[key] || 'Page'}</h1><p>Some article text about tonkotsu broth and noodles.</p></body>`);
  });
  return new Promise<{ base: string; close: () => void; cancelled: () => number }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => { server.closeAllConnections(); server.close(); }, cancelled: () => cancelledStreams })),
  );
}

export const test = base.extend<{ context: BrowserContext; extensionId: string; server: { base: string; cancelled: () => number } }>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const s = await startServer();
    await use(s);
    s.close();
  },
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADFUL,
      colorScheme: (process.env.COLOR_SCHEME as 'light' | 'dark') || 'light',
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
});

export { expect } from '@playwright/test';

export async function paletteFrame(page: Page): Promise<Frame> {
  for (let i = 0; i < 50; i++) {
    const frame = page.frames().find((f) => f.url().includes('/palette.html'));
    if (frame && (await frame.locator('.query').isVisible().catch(() => false))) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error('palette did not open');
}

export async function openOverlay(page: Page): Promise<Frame> {
  await page.keyboard.press('Control+e');
  return paletteFrame(page);
}

export async function rows(frame: Frame | Page) {
  return frame.locator('.results .row').evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector('.title, .label')?.textContent || '',
      answer: el.querySelector('.answer')?.textContent || '',
      kind: [...el.classList].find((c) => c.startsWith('kind-'))?.slice(5) || '',
      selected: el.classList.contains('selected'),
    })),
  );
}
