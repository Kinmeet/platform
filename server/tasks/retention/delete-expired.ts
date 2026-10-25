import type { D1Database } from '@cloudflare/workers-types'
import { deleteExpiredRows, type DeletionCounts } from '../../utils/db/deletion'

/**
 * Daily deletion job (#31). Runs on the cron trigger in `wrangler.jsonc`
 * through Nitro's scheduled tasks (`nuxt.config.ts`). Logs counts only.
 */
export default defineTask<DeletionCounts | 'failed'>({
  meta: {
    name: 'retention:delete-expired',
    description: 'Delete personal data whose deletion date has passed (P3)',
  },
  async run({ context }) {
    const db = (context as { cloudflare?: { env?: { DB?: D1Database } } }).cloudflare?.env?.DB
    if (!db) {
      console.error(JSON.stringify({ code: 'deletion_db_missing' }))
      return { result: 'failed' }
    }
    try {
      const deleted = await deleteExpiredRows(db)
      console.log(JSON.stringify({ code: 'deletion_done', deleted }))
      return { result: deleted }
    } catch {
      console.error(JSON.stringify({ code: 'deletion_failed' }))
      return { result: 'failed' }
    }
  },
})
