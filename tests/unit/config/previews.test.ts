import { describe, expect, it } from 'vitest'
import wranglerConfig from '../../../wrangler.jsonc?raw'
import previewMigrationsConfig from '../../../wrangler.preview-migrations.jsonc?raw'
import { parseJsonc } from '../helpers/jsonc'

// The `platform` Worker's Previews serve every branch except `live`, with
// made-up data only (ADR-0001, #115). These checks keep live data and live
// logging settings out of them.

interface D1 {
  binding: string
  database_name: string
  database_id: string
}

interface Level {
  name?: string
  observability?: unknown
  logpush?: boolean
  triggers?: unknown
  vars?: Record<string, string>
  d1_databases?: D1[]
  kv_namespaces?: { binding: string; id: string }[]
  r2_buckets?: { binding: string; bucket_name: string; jurisdiction?: string }[]
  ratelimits?: { name: string; namespace_id: string }[]
  previews?: Level
}

const config = parseJsonc(wranglerConfig) as Level & { env: Record<string, Level> }
const live = config.env.live!
const previews = live.previews!
const migrations = parseJsonc(previewMigrationsConfig) as { account_id: string; d1_databases: D1[] }

describe('Previews of the platform Worker', () => {
  it('belong to the platform Worker', () => {
    expect(live.name).toBe('platform')
    expect(previews).toBeDefined()
  })

  it('name no live database, namespace or bucket', () => {
    const liveIds = [
      ...(live.d1_databases ?? []).flatMap((d) => [d.database_name, d.database_id]),
      ...(live.kv_namespaces ?? []).map((k) => k.id),
      ...(live.r2_buckets ?? []).map((r) => r.bucket_name),
    ]
    expect(liveIds.length).toBeGreaterThan(0)
    const text = JSON.stringify(previews)
    for (const id of liveIds) expect(text).not.toContain(id)
    expect(text).not.toMatch(/kinmeet-live/)
  })

  it('bind every resource production binds, under the same names', () => {
    const names = (level: Level) => ({
      d1: (level.d1_databases ?? []).map((d) => d.binding).sort(),
      kv: (level.kv_namespaces ?? []).map((k) => k.binding).sort(),
      r2: (level.r2_buckets ?? []).map((r) => r.binding).sort(),
      ratelimits: (level.ratelimits ?? []).map((r) => r.name).sort(),
    })
    expect(names(previews)).toEqual(names(live))
  })

  it('keep R2 in the EU jurisdiction', () => {
    for (const bucket of previews.r2_buckets ?? []) expect(bucket.jurisdiction).toBe('eu')
  })

  it('never share rate-limit counters with production', () => {
    const liveIds = new Set((live.ratelimits ?? []).map((r) => r.namespace_id))
    for (const limiter of previews.ratelimits ?? []) {
      expect(liveIds.has(limiter.namespace_id)).toBe(false)
    }
  })

  it('log exactly as production does (P5)', () => {
    expect(previews.observability).toEqual(live.observability)
    expect(previews.logpush).toBe(false)
    expect(live.logpush).toBe(false)
  })

  it('say they are a Preview', () => {
    expect(previews.vars?.KINMEET_ENV).toBe('preview')
    expect(live.vars?.KINMEET_ENV).toBe('live')
  })

  it('are migrated through a config that names the same database', () => {
    expect(migrations.account_id).toBe('0fa695ccf43f64b3eb9fae94520109b4')
    const [target] = migrations.d1_databases
    const [bound] = previews.d1_databases ?? []
    expect(migrations.d1_databases).toHaveLength(1)
    expect(target?.database_name).toBe(bound?.database_name)
    expect(target?.database_id).toBe(bound?.database_id)
  })
})
