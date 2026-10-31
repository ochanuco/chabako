// secret は wrangler types に出ないので、ここで足す
interface Env {
  // 転送先。Email Routing で確認済みのアドレスでないと forward が失敗する。public repo に載せないよう secret にする
  FORWARD_TO: string;
  // 新しいアドレスの通知と、Webhook を持たないアドレスの配信先
  DISCORD_WEBHOOK_URL?: string;
}
