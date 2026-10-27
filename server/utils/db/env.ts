import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'

/** The main D1 database (`DB`), or an error if the binding is missing. */
export function useDb(event: H3Event): D1Database {
  const db = (event.context as { cloudflare?: { env?: { DB?: D1Database } } }).cloudflare?.env?.DB
  if (!db) throw new Error('db_binding_missing')
  return db
}
