# chabako

`ochanu.co` 宛のメールを受ける Cloudflare Worker。サービスごとにアドレスを分けて使い、読むのは Gmail。

- 受信: Email Routing の catch-all がこの Worker に渡す。宛先は `+` 以降を除いたアドレスで台帳（D1）に数え、初めてのアドレスは自動で登録して Discord に知らせる。止めたアドレス宛は reject する。
- 転送: secret `FORWARD_TO`（Email Routing で確認済みの Gmail）へ転送し、原文を R2（`chabako-raw`、90 日で消える）に残す。
- Discord: アドレスごとに配信の ON/OFF と Webhook を決める。Webhook を空にしたアドレスは secret `DISCORD_WEBHOOK_URL` に流す。
- 管理 UI: `https://chabako.chanu.co`。Cloudflare Access（chabatake の `cloudflare/app_chabako.tf`）が守る。

Email Routing・Access の設定は chabatake にある。D1 と R2 はこの repo の wrangler の設定が指す。

## 開発

```sh
pnpm install
pnpm run typecheck
pnpm test
```

## デプロイ

main への push で `deploy` workflow が出す。D1 migration は自動では当たらないので、`migrations/` を変えたら `pnpm exec wrangler d1 migrations apply chabako --remote` を手で実行する。

secret は `pnpm exec wrangler secret put <名前>` で入れる。`FORWARD_TO` は必須で、無いと転送が失敗する。`DISCORD_WEBHOOK_URL` は Discord の既定の Webhook。
