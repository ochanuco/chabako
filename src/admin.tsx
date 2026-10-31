import { Hono } from 'hono';
import type { FC, PropsWithChildren } from 'hono/jsx';

type AliasRow = {
  address: string;
  status: 'active' | 'stopped';
  notify: number;
  discord_webhook: string | null;
  note: string | null;
  created_at: string;
  last_received_at: string | null;
  received_count: number;
};

type MessageRow = {
  id: string;
  alias: string;
  recipient: string;
  sender: string;
  subject: string | null;
  received_at: string;
  raw_key: string | null;
  outcome: 'forwarded' | 'rejected';
};

const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} - chabako</title>
      <style>{`
        body { font-family: system-ui, sans-serif; margin: 16px; color: #222; background: #fff; }
        @media (prefers-color-scheme: dark) { body { color: #ddd; background: #181818; } a { color: #8ab4f8; } }
        nav a { margin-right: 12px; }
        table { border-collapse: collapse; width: 100%; font-size: 14px; }
        th, td { border-bottom: 1px solid #8884; padding: 6px; text-align: left; vertical-align: top; }
        .stopped { opacity: 0.5; }
        .scroll { overflow-x: auto; }
        input[type=text], input[type=url] { width: 14em; }
      `}</style>
    </head>
    <body>
      <nav>
        <a href="/">アドレス</a>
        <a href="/messages">受信ログ</a>
      </nav>
      <h1>{title}</h1>
      {children}
    </body>
  </html>
);

export const admin = new Hono<{ Bindings: Env }>();

// Access の Cookie を持ったまま別サイトからフォームを送らせない
admin.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.header('origin') !== c.env.ADMIN_ORIGIN) {
    return c.text('forbidden', 403);
  }
  await next();
});

admin.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM aliases ORDER BY last_received_at IS NULL, last_received_at DESC, address',
  ).all<AliasRow>();
  return c.html(
    <Layout title="アドレス">
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>アドレス</th>
              <th>受信</th>
              <th>最終受信</th>
              <th>状態・Discord・メモ</th>
            </tr>
          </thead>
          <tbody>
            {results.map((a) => (
              <tr class={a.status}>
                <td>
                  <a href={`/messages?alias=${encodeURIComponent(a.address)}`}>{a.address}</a>
                </td>
                <td>{a.received_count}</td>
                <td>{a.last_received_at?.slice(0, 16).replace('T', ' ') ?? '-'}</td>
                <td>
                  <form method="post" action={`/aliases/${encodeURIComponent(a.address)}`}>
                    <select name="status">
                      <option value="active" selected={a.status === 'active'}>
                        受ける
                      </option>
                      <option value="stopped" selected={a.status === 'stopped'}>
                        止める
                      </option>
                    </select>{' '}
                    <label>
                      <input type="checkbox" name="notify" value="1" checked={a.notify === 1} /> Discord
                    </label>{' '}
                    <input
                      type="url"
                      name="discord_webhook"
                      placeholder="Webhook（空なら既定）"
                      value={a.discord_webhook ?? ''}
                    />{' '}
                    <input type="text" name="note" placeholder="メモ" value={a.note ?? ''} />{' '}
                    <button type="submit">保存</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>,
  );
});

admin.post('/aliases/:address', async (c) => {
  const address = c.req.param('address');
  const form = await c.req.formData();
  const status = form.get('status') === 'stopped' ? 'stopped' : 'active';
  const webhook = String(form.get('discord_webhook') ?? '').trim();
  if (webhook && !webhook.startsWith('https://discord.com/api/webhooks/')) {
    return c.text('discord_webhook must be a Discord webhook URL', 400);
  }
  const note = String(form.get('note') ?? '').trim();
  const { meta } = await c.env.DB.prepare(
    'UPDATE aliases SET status = ?, notify = ?, discord_webhook = ?, note = ? WHERE address = ?',
  )
    .bind(status, form.get('notify') === '1' ? 1 : 0, webhook || null, note || null, address)
    .run();
  if (meta.changes === 0) return c.notFound();
  return c.redirect('/', 303);
});

admin.get('/messages', async (c) => {
  const alias = c.req.query('alias');
  const stmt = alias
    ? c.env.DB.prepare('SELECT * FROM messages WHERE alias = ? ORDER BY received_at DESC LIMIT 200').bind(alias)
    : c.env.DB.prepare('SELECT * FROM messages ORDER BY received_at DESC LIMIT 200');
  const { results } = await stmt.all<MessageRow>();
  return c.html(
    <Layout title={alias ? `受信ログ: ${alias}` : '受信ログ'}>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>日時</th>
              <th>宛先</th>
              <th>差出人</th>
              <th>件名</th>
              <th>結果</th>
            </tr>
          </thead>
          <tbody>
            {results.map((m) => (
              <tr>
                <td>{m.received_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{m.recipient}</td>
                <td>{m.sender}</td>
                <td>{m.raw_key ? <a href={`/messages/${m.id}/raw`}>{m.subject || '（件名なし）'}</a> : m.subject}</td>
                <td>{m.outcome === 'forwarded' ? '転送' : '拒否'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>,
  );
});

admin.get('/messages/:id/raw', async (c) => {
  const row = await c.env.DB.prepare('SELECT raw_key FROM messages WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ raw_key: string | null }>();
  const object = row?.raw_key ? await c.env.RAW.get(row.raw_key) : null;
  if (!object) return c.text('原文は保存期間（90 日）を過ぎたか、保存されていない', 404);
  return new Response(object.body, {
    headers: {
      'content-type': 'message/rfc822',
      'content-disposition': `attachment; filename="${c.req.param('id')}.eml"`,
    },
  });
});
