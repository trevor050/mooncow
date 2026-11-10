// Temporary baseline probe: load the extension in real Firefox and type queries.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const queries = process.argv.slice(3);
const server = http.createServer((req, res) => { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>Test page</title><h1>Hello</h1><p>Some page text.</p>'); }).listen(0);
const port = server.address().port;
const browser = await puppeteer.launch({ browser: 'firefox', executablePath: '/Applications/Firefox.app/Contents/MacOS/firefox', headless: true });
try {
  const id = await browser.installExtension(root);
  console.log('installed', id);
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));
  await page.goto(`http://127.0.0.1:${port}/`);
  await new Promise(r => setTimeout(r, 800));
  await page.keyboard.down('Control'); await page.keyboard.press('e'); await page.keyboard.up('Control');
  await new Promise(r => setTimeout(r, 1500));
  let frame = null;
  for (const f of page.frames()) { try { if (await f.evaluate(() => !!document.getElementById('search-input'))) frame = f; } catch (_) {} }
  if (!frame) { console.log('NO PANEL FRAME', page.frames().map(f => f.url())); process.exit(1); }
  for (const q of queries) {
    await frame.evaluate(() => { const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await frame.type('#search-input', q, { delay: 10 });
    await new Promise(r => setTimeout(r, 1800));
    const rows = await frame.evaluate(() => Array.from(document.querySelectorAll('#results > *')).slice(0, 5).map(e => e.innerText.replace(/\s+/g, ' ').slice(0, 110)));
    console.log(`\n[${q}]`); rows.forEach(r => console.log('  -', r));
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/${q.replace(/[^a-z0-9]+/gi,'_').slice(0,30)}.png` });
  }
  console.log('\nconsole errors:'); logs.filter(l => /error|warn/i.test(l)).slice(0, 15).forEach(l => console.log('  ', l.slice(0, 200)));
} finally { await browser.close(); server.close(); }
