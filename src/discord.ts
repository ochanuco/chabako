const SNIPPET_LENGTH = 300;

async function post(webhook: string, embed: Record<string, unknown>): Promise<void> {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // メール本文に @everyone などが入っていてもメンションにしない
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) console.error('discord webhook failed', res.status, await res.text());
}

export function notifyNewAlias(webhook: string, address: string, from: string): Promise<void> {
  return post(webhook, {
    title: '新しいアドレスに届いた',
    description: address,
    fields: [{ name: '差出人', value: from }],
  });
}

export function notifyMessage(
  webhook: string,
  mail: { from: string; to: string; subject: string; text: string },
): Promise<void> {
  const text = mail.text.trim();
  return post(webhook, {
    title: (mail.subject || '（件名なし）').slice(0, 256),
    description: text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH)}…` : text,
    fields: [
      { name: '差出人', value: mail.from, inline: true },
      { name: '宛先', value: mail.to, inline: true },
    ],
  });
}
