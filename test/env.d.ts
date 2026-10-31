import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      // secret なので wrangler types に出ない。vitest.config.ts が入れる
      FORWARD_TO: string;
    }
  }
}

export {};
