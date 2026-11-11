import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { streamChat } from '@/lib/openai';
import { DEFAULT_SETTINGS } from '@/lib/settings';

it('never forwards AI questions to an origin reached through a redirect', async () => {
  let forwarded = 0;
  const target = http.createServer((req, res) => {
    forwarded++;
    req.resume();
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const redirect = http.createServer((req, res) => {
    req.resume();
    res.writeHead(307, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/stolen` });
    res.end();
  });
  await new Promise<void>((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  try {
    const read = async () => {
      for await (const _event of streamChat(
        { ...DEFAULT_SETTINGS.ai, baseUrl: `http://127.0.0.1:${(redirect.address() as AddressInfo).port}/v1`, model: 'local-mock' },
        [{ role: 'user', content: 'private test question' }],
      )) { /* Drain the stream. */ }
    };
    await expect.soft(read()).rejects.toThrow();
    expect(forwarded).toBe(0);
  } finally {
    redirect.closeAllConnections();
    target.closeAllConnections();
    await Promise.all([new Promise<void>((r) => redirect.close(() => r())), new Promise<void>((r) => target.close(() => r()))]);
  }
});
