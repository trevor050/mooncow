import { expect, openOverlay, paletteFrame, rows, test } from './fixtures';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('opens instantly over a page and answers in place', async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(server.base + '/');
  const started = Date.now();
  const frame = await openOverlay(page);
  expect(Date.now() - started).toBeLessThan(3000);
  await expect(frame.locator('.query')).toBeFocused();

  await frame.locator('.query').fill('2+2*3');
  await expect.poll(async () => (await rows(frame))[0]?.answer).toBe('8');
  await frame.locator('.query').fill('#ff8800');
  await expect.poll(async () => (await rows(frame))[0]?.title).toBe('#FF8800');
  await frame.locator('.query').fill('10 km to mi');
  await expect.poll(async () => (await rows(frame))[0]?.answer).toBe('6.2137 mi');
  await frame.locator('.query').fill('5x + 3 = 8');
  await expect.poll(async () => (await rows(frame))[0]?.answer, { timeout: 10_000 }).toBe('x = 1');

  // Enter copies an answer and says so.
  await frame.locator('.query').fill('sha256 abc');
  await expect.poll(async () => (await rows(frame))[0]?.answer).toMatch(/^ba7816bf/);
  await frame.locator('.query').press('Enter');
  await expect(frame.locator('.toast')).toHaveText('Copied');

  await frame.locator('.query').press('Escape');
  await expect(page.locator('mooncow-palette')).toBeHidden();
});

test('open tabs come first, and Enter switches to them', async ({ context, server, extensionId }) => {
  const gmail = await context.newPage();
  await gmail.goto(server.base + '/gmail');
  const pr = await context.newPage();
  await pr.goto(server.base + '/pr');
  const page = await context.newPage();
  await page.goto(server.base + '/');
  const frame = await openOverlay(page);

  // A loose letter match ("gml") is offered second; a word match takes the top spot.
  await frame.locator('.query').fill('gml');
  await expect.poll(async () => (await rows(frame)).findIndex((r) => r.kind === 'tab')).toBe(1);
  await frame.locator('.query').fill('gmail');
  await expect.poll(async () => (await rows(frame))[0]).toMatchObject({ kind: 'tab', title: 'Inbox (3) - you@example.com - Gmail' });
  await frame.locator('.query').press('Enter');

  const [worker] = context.serviceWorkers();
  await expect
    .poll(() => worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.title))
    .toBe('Inbox (3) - you@example.com - Gmail');
  expect(extensionId).toBeTruthy();
});

test('every row has verbs: the action menu closes a tab', async ({ context, server }) => {
  const victim = await context.newPage();
  await victim.goto(server.base + '/figma');
  const page = await context.newPage();
  await page.goto(server.base + '/');
  const frame = await openOverlay(page);
  await frame.locator('.query').fill('figma');
  await expect.poll(async () => (await rows(frame))[0]?.kind).toBe('tab');

  await frame.locator('.query').press(`${mod}+k`);
  const menu = frame.locator('.menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.menu-item')).toHaveText([/Switch to tab/, /Close tab/, /Pin tab/, /Mute tab/, /Duplicate tab/, /Move to new window/, /Reload tab/, /Copy URL/]);
  await expect(menu).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => victim.isClosed()).toBe(true);
});

test('commands: close duplicate tabs, then reopen the closed one', async ({ context, server }) => {
  for (let i = 0; i < 2; i++) await (await context.newPage()).goto(server.base + '/docs');
  const page = await context.newPage();
  await page.goto(server.base + '/');
  let frame = await openOverlay(page);

  await frame.locator('.query').fill('>');
  await expect.poll(async () => (await rows(frame)).length).toBeGreaterThan(20);
  await frame.locator('.query').fill('close dupl');
  await expect.poll(async () => (await rows(frame))[0]?.title).toBe('Close duplicate tabs');
  await frame.locator('.query').press('Enter');
  await expect.poll(() => context.pages().filter((p) => p.url().endsWith('/docs')).length).toBe(1);

  frame = await openOverlay(page);
  await frame.locator('.query').fill('closed');
  await expect.poll(async () => (await rows(frame))[0]?.title).toBe('Content Scripts – WXT');
  await frame.locator('.query').press('Enter');
  await expect.poll(() => context.pages().filter((p) => p.url().endsWith('/docs')).length).toBe(2);
});

test('does not misfire on look-alike queries', async ({ context, server }) => {
  const page = await context.newPage();
  await page.goto(server.base + '/');
  const frame = await openOverlay(page);
  for (const q of ['back to the future', 'time complexity of quicksort', 'password manager reviews', 'how to roll sushi']) {
    await frame.locator('.query').fill(q);
    // Web search or AI may lead; no tool answer or command may.
    await expect.poll(async () => ['search', 'ai'].includes((await rows(frame))[0]?.kind)).toBe(true);
  }
});

test('the new tab page is the same bar at full size', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`);
  const input = page.locator('.query');
  await input.click();
  await input.fill('days until christmas');
  await expect.poll(async () => (await rows(page))[0]?.answer).toMatch(/^\d+ days?$/);
});

test('AI chat streams from an OpenAI-compatible endpoint', async ({ context, server }) => {
  const [worker] = context.serviceWorkers();
  await worker.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({ settings: { theme: 'system', suggestions: false, newTabPage: true, ai: { baseUrl, apiKey: 'test-key', model: 'mock-model', reasoningEffort: '' } } });
  }, server.base + '/v1');
  const page = await context.newPage();
  await page.goto(server.base + '/');
  const frame = await openOverlay(page);
  await frame.locator('.query').fill('ai what is tonkotsu');
  await expect.poll(async () => (await rows(frame))[0]?.kind).toBe('ai');
  await frame.locator('.query').press('Enter');
  await expect(frame.locator('.msg.user')).toHaveText('what is tonkotsu');
  await expect(frame.locator('.msg.assistant strong')).toHaveText('Short answer:');
  await expect(frame.locator('.msg.assistant')).toContainText('Model was mock-model.');

  // Follow-ups keep the conversation; Esc goes back to the list.
  await frame.locator('.chat-input').fill('and shoyu?');
  await frame.locator('.chat-input').press('Enter');
  await expect(frame.locator('.msg.assistant')).toHaveCount(2);
  await frame.locator('.chat-input').press('Escape');
  await expect(frame.locator('.query')).toBeVisible();
  await paletteFrame(page);
});

test('turning the new tab page off hands new tabs back to Chrome', async ({ context, extensionId }) => {
  const [worker] = context.serviceWorkers();
  await worker.evaluate(() => chrome.storage.local.set({ settings: { theme: 'system', suggestions: false, newTabPage: false, ai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-6-luna', reasoningEffort: '' } } }));
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/newtab.html`).catch(() => {});
  await expect.poll(() => worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url || t.pendingUrl).join(' '))).toContain('chrome://new-tab-page');
});

test('closing the bar cancels a local AI stream', async ({ context, server, extensionId }) => {
  const [worker] = context.serviceWorkers();
  await worker.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({ settings: { theme: 'system', suggestions: false, newTabPage: true, ai: { baseUrl, apiKey: '', model: 'mock-model', reasoningEffort: '' } } });
  }, server.base + '/slow/v1');
  const page = await context.newPage();
  await page.goto(server.base);
  const frame = await openOverlay(page);
  await frame.locator('.query').fill('ai cancel this local stream');
  await frame.locator('.query').press('Enter');
  await expect(frame.locator('.msg.assistant.streaming')).toContainText('streaming');
  await frame.locator('.chat-input').press(`${mod}+e`);
  await expect(page.locator('mooncow-palette')).toBeHidden();
  await expect.poll(() => server.cancelled()).toBeGreaterThan(0);
  expect(extensionId).toBeTruthy();
});
