import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { admin } from '../src/admin';

function post(path: string, fields: Record<string, string>, origin: string = env.ADMIN_ORIGIN) {
  return admin.request(
    path,
    { method: 'POST', headers: { origin }, body: new URLSearchParams(fields) },
    env,
  );
}

describe('admin', () => {
  it('stops an address and turns on Discord', async () => {
    await env.DB.prepare(`INSERT INTO aliases (address, created_at) VALUES ('shop@example.com', '2026-01-01')`).run();
    const res = await post('/aliases/shop%40example.com', {
      status: 'stopped',
      notify: '1',
      discord_webhook: 'https://discord.com/api/webhooks/1/x',
      note: 'shop',
    });

    expect(res.status).toBe(303);
    const row = await env.DB.prepare(`SELECT status, notify, discord_webhook, note FROM aliases`).first();
    expect(row).toEqual({ status: 'stopped', notify: 1, discord_webhook: 'https://discord.com/api/webhooks/1/x', note: 'shop' });
  });

  it('refuses a form posted from another site', async () => {
    const res = await post('/aliases/shop%40example.com', { status: 'stopped' }, 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('refuses a webhook that is not Discord', async () => {
    await env.DB.prepare(`INSERT INTO aliases (address, created_at) VALUES ('a@example.com', '2026-01-01')`).run();
    const res = await post('/aliases/a%40example.com', { status: 'active', discord_webhook: 'https://evil.example/hook' });
    expect(res.status).toBe(400);
  });

  it('lists addresses', async () => {
    await env.DB.prepare(`INSERT INTO aliases (address, created_at) VALUES ('list@example.com', '2026-01-01')`).run();
    const res = await admin.request('/', {}, env);
    expect(await res.text()).toContain('list@example.com');
  });
});
