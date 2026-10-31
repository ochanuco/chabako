import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aliasOf, handleEmail } from '../src/email';

const WEBHOOK = 'https://discord.com/api/webhooks/1/alias';

function mail(to: string, subject = 'hello') {
  const raw = [
    'From: Shop <news@shop.example>',
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'body text',
  ].join('\r\n');
  const bytes = new TextEncoder().encode(raw);
  return {
    from: 'bounce@shop.example',
    to,
    // 実際のヘッダは MIME で ASCII に符号化されて届く
    headers: new Headers(/^[\x20-\x7e]*$/.test(subject) ? { subject } : {}),
    raw: new Response(bytes).body!,
    rawSize: bytes.byteLength,
    setReject: vi.fn(),
    forward: vi.fn(async () => ({ messageId: 'x' })),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage & { setReject: ReturnType<typeof vi.fn>; forward: ReturnType<typeof vi.fn> };
}

function context() {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  return { ctx, settle: () => Promise.all(pending) };
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
});
afterEach(() => fetchSpy.mockRestore());

describe('aliasOf', () => {
  it('drops the plus tag and lowercases', () => {
    expect(aliasOf('Shop+News@Example.com')).toBe('shop@example.com');
  });
});

describe('handleEmail', () => {
  it('registers a new address, forwards, stores the raw message and announces the address', async () => {
    const m = mail('shop+a@example.com');
    const { ctx, settle } = context();
    await handleEmail(m, { ...env, DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/default' }, ctx);
    await settle();

    expect(m.forward).toHaveBeenCalledWith(env.FORWARD_TO);
    const alias = await env.DB.prepare('SELECT * FROM aliases WHERE address = ?').bind('shop@example.com').first();
    expect(alias).toMatchObject({ status: 'active', notify: 0, received_count: 1 });
    const row = await env.DB.prepare(`SELECT * FROM messages WHERE alias = 'shop@example.com'`).first<{ raw_key: string; subject: string }>();
    expect(row?.subject).toBe('hello');
    expect(await (await env.RAW.get(row!.raw_key))?.text()).toContain('body text');
    // notify が既定で OFF なので、届くのは新しいアドレスの通知だけ
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('https://discord.com/api/webhooks/1/default');
  });

  it('rejects mail to a stopped address without forwarding', async () => {
    await env.DB.prepare(`INSERT INTO aliases (address, status, created_at) VALUES ('old@example.com', 'stopped', '2026-01-01')`).run();
    const m = mail('old@example.com');
    const { ctx } = context();
    await handleEmail(m, env, ctx);

    expect(m.setReject).toHaveBeenCalled();
    expect(m.forward).not.toHaveBeenCalled();
    const row = await env.DB.prepare(`SELECT outcome FROM messages WHERE alias = 'old@example.com'`).first();
    expect(row).toEqual({ outcome: 'rejected' });
  });

  it('posts a summary to the address webhook when notify is on', async () => {
    await env.DB.prepare(
      `INSERT INTO aliases (address, notify, discord_webhook, created_at) VALUES ('bank@example.com', 1, ?, '2026-01-01')`,
    )
      .bind(WEBHOOK)
      .run();
    const { ctx, settle } = context();
    await handleEmail(mail('bank@example.com', '@everyone ご利用明細'), env, ctx);
    await settle();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    const body = JSON.parse(init.body as string);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.embeds[0]).toMatchObject({ title: '@everyone ご利用明細', description: 'body text' });
  });

  it('still forwards when the ledger cannot be read', async () => {
    const m = mail('any@example.com');
    const broken = { ...env, DB: { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database };
    const { ctx } = context();
    await handleEmail(m, broken, ctx);

    expect(m.forward).toHaveBeenCalled();
  });
});
