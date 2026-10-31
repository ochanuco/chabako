import PostalMime from 'postal-mime';
import { notifyMessage, notifyNewAlias } from './discord';

export type Alias = {
  address: string;
  status: 'active' | 'stopped';
  notify: number;
  discord_webhook: string | null;
};

// foo+shop@example.com は foo@example.com として数える
export function aliasOf(recipient: string): string {
  const [local = '', domain = ''] = recipient.toLowerCase().split('@');
  return `${local.split('+')[0]}@${domain}`;
}

function rawKey(id: string, receivedAt: string): string {
  return `${receivedAt.slice(0, 10).replaceAll('-', '/')}/${id}.eml`;
}

async function findOrCreateAlias(db: D1Database, address: string, now: string): Promise<{ alias: Alias; created: boolean }> {
  const inserted = await db
    .prepare('INSERT INTO aliases (address, created_at) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING address')
    .bind(address, now)
    .first();
  const alias = await db
    .prepare('SELECT address, status, notify, discord_webhook FROM aliases WHERE address = ?')
    .bind(address)
    .first<Alias>();
  if (!alias) throw new Error(`alias ${address} vanished after insert`);
  return { alias, created: inserted !== null };
}

export async function handleEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const address = aliasOf(message.to);

  // 台帳が引けなくてもメールは落とさず、止めていないアドレスとして転送する
  let lookup: { alias: Alias; created: boolean } | null = null;
  try {
    lookup = await findOrCreateAlias(env.DB, address, now);
  } catch (err) {
    console.error('alias lookup failed', err);
  }

  if (lookup?.alias.status === 'stopped') {
    message.setReject('This address is no longer in use');
    await env.DB.prepare(
      `INSERT INTO messages (id, alias, recipient, sender, subject, received_at, size, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected')`,
    )
      .bind(id, address, message.to, message.from, message.headers.get('subject'), now, message.rawSize)
      .run()
      .catch((err) => console.error('reject log failed', err));
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  await message.forward(env.FORWARD_TO);

  // ここから先は転送の後なので、失敗しても送信者には返さない
  try {
    const parsed = await PostalMime.parse(raw);
    const key = rawKey(id, now);
    await env.RAW.put(key, raw, { httpMetadata: { contentType: 'message/rfc822' } });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO messages (id, alias, recipient, sender, subject, received_at, size, raw_key, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'forwarded')`,
      ).bind(id, address, message.to, message.from, parsed.subject ?? null, now, message.rawSize, key),
      env.DB.prepare(
        'UPDATE aliases SET last_received_at = ?, received_count = received_count + 1 WHERE address = ?',
      ).bind(now, address),
    ]);

    if (lookup?.created && env.DISCORD_WEBHOOK_URL) {
      ctx.waitUntil(notifyNewAlias(env.DISCORD_WEBHOOK_URL, address, message.from));
    }
    const webhook = lookup?.alias.discord_webhook ?? env.DISCORD_WEBHOOK_URL;
    if (lookup?.alias.notify && webhook) {
      ctx.waitUntil(
        notifyMessage(webhook, {
          from: parsed.from?.address ?? message.from,
          to: message.to,
          subject: parsed.subject ?? '',
          text: parsed.text ?? '',
        }),
      );
    }
  } catch (err) {
    console.error('bookkeeping after forward failed', err);
  }
}
