import type { D1Database } from '@cloudflare/workers-types'
import { deleteExpiredRows, type DeletionCounts } from '../../utils/db/deletion'

/**
 * Daily deletion job (#31). Runs on the cron trigger in `wrangler.jsonc`
 * through Nitro's scheduled tasks (`nuxt.config.ts`). Logs counts only.
 *
 * A run that cannot delete logs a code and then throws, so the cron run
 * shows as an exception in Workers Logs and the Worker's cron history
 * rather than a silent success (Theo's review of #50). Personal data must
 * never quietly outlive its P3 date.
 */
export default defineTask<DeletionCounts>({
  meta: {
    name: 'retention:delete-expired',
    description: 'Delete personal data whose deletion date has passed (P3)',
  },
  async run({ context }) {
    const db = (context as { cloudflare?: { env?: { DB?: D1Database } } }).cloudflare?.env?.DB
    if (!db) {
      console.error(JSON.stringify({ code: 'deletion_db_missing' }))
      throw new Error('deletion_db_missing')
    }
    let deleted: DeletionCounts
    try {
      deleted = await deleteExpiredRows(db)
    } catch {
      // The D1 error is not logged: it could quote a value from a row.
      console.error(JSON.stringify({ code: 'deletion_failed' }))
      throw new Error('deletion_failed')
    }
    console.log(JSON.stringify({ code: 'deletion_done', deleted }))
    return { result: deleted }
  },
})
