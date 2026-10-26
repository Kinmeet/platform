import type { D1Migration } from 'cloudflare:test'

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_DB_MIGRATIONS: D1Migration[]
      SAFEGUARDING_DB: D1Database
      TEST_SAFEGUARDING_MIGRATIONS: D1Migration[]
    }
  }
}
