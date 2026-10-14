import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openaiChat, type TextRoute } from '../src/lib/server/providers.ts';

test('Kimi uses provider sampling defaults and disables reasoning on both routes', async (t) => {
  const previous = process.env.KIMI_REASONING;
  delete process.env.KIMI_REASONING;
  t.after(() => { if (previous === undefined) delete process.env.KIMI_REASONING; else process.env.KIMI_REASONING = previous; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.equal(body.temperature, undefined);
    if (body.thinking) assert.equal(body.thinking.type, 'disabled');
    else assert.deepEqual(body.reasoning, { enabled: false });
    return Response.json({ choices: [{ message: { content: '{"title":"Ready"}' } }] });
  });
  for (const via of ['direct', 'fal'] as const) {
    const route: TextRoute = { family: 'kimi', via, base: 'https://provider.invalid/v1', model: 'kimi-k2.6', auth: 'test' };
    const result = await openaiChat(route, { messages: [{ role: 'user', content: 'Write a comic' }], json: true });
    assert.equal(result.content, '{"title":"Ready"}');
  }
});

test('Hunyuan keeps its configured sampling temperature', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    assert.equal(JSON.parse(String(init.body)).temperature, 0.8);
    return Response.json({ choices: [{ message: { content: 'Ready' } }] });
  });
  await openaiChat({ family: 'hunyuan', via: 'direct', base: 'https://provider.invalid/v1', model: 'hy3', auth: 'test' }, { messages: [] });
});

test('direct Kimi honors the explicit reasoning opt-in', async (t) => {
  const previous = process.env.KIMI_REASONING;
  process.env.KIMI_REASONING = 'on';
  t.after(() => { if (previous === undefined) delete process.env.KIMI_REASONING; else process.env.KIMI_REASONING = previous; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    assert.deepEqual(body.thinking, { type: 'enabled' });
    assert.equal(body.temperature, undefined);
    return Response.json({ choices: [{ message: { content: 'Ready' } }] });
  });
  await openaiChat({ family: 'kimi', via: 'direct', base: 'https://provider.invalid/v1', model: 'kimi-k2.6', auth: 'test' }, { messages: [] });
});
