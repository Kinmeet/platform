import { describe, expect, it } from 'vitest'
import wranglerConfig from '../../../wrangler.jsonc?raw'
import vitestConfig from '../../../vitest.config.ts?raw'
import packageJson from '../../../package.json'
import { deployEnvironmentProblem } from '../../../shared/deploy-env'
import { parseJsonc } from '../helpers/jsonc'

// NuxtHub phase 1 (ADR-0009): the build check, the pinned migrations table
// and the compatibility flags that the generated config deploys with.

interface D1 {
  binding: string
  migrations_table?: string
}

interface Level {
  compatibility_flags?: string[]
  d1_databases?: D1[]
  previews?: Level
  env?: Record<string, Level>
}

const config = parseJsonc(wranglerConfig) as Level

function levels(level: Level): Level[] {
  return [
    level,
    ...(level.previews ? levels(level.previews) : []),
    ...Object.values(level.env ?? {}).flatMap(levels),
  ]
}

describe('the Workers Builds build check', () => {
  it('stops a Workers Builds build with no environment, or an unknown one', () => {
    expect(deployEnvironmentProblem({ WORKERS_CI: '1' })).toMatch(/not set/)
    expect(deployEnvironmentProblem({ WORKERS_CI: '1', CLOUDFLARE_ENV: '' })).toMatch(/not set/)
    expect(deployEnvironmentProblem({ WORKERS_CI: '1', CLOUDFLARE_ENV: 'Live' })).toMatch(/"Live"/)
    expect(deployEnvironmentProblem({ WORKERS_CI: '1', CLOUDFLARE_ENV: 'preview' })).toMatch(
      /"preview"/,
    )
  })

  it('lets a Workers Builds build for live or staging through', () => {
    expect(deployEnvironmentProblem({ WORKERS_CI: '1', CLOUDFLARE_ENV: 'live' })).toBeNull()
    expect(deployEnvironmentProblem({ WORKERS_CI: '1', CLOUDFLARE_ENV: 'staging' })).toBeNull()
  })

  it('leaves local and CI builds alone', () => {
    expect(deployEnvironmentProblem({})).toBeNull()
    expect(deployEnvironmentProblem({ CLOUDFLARE_ENV: 'live' })).toBeNull()
  })
})

describe('wrangler.jsonc for NuxtHub', () => {
  it("pins Wrangler's migrations table on every DB, so no migration runs twice", () => {
    const databases = levels(config).flatMap((level) => level.d1_databases ?? [])
    const db = databases.filter((d) => d.binding === 'DB')
    expect(db.length).toBeGreaterThanOrEqual(4)
    for (const entry of db) expect(entry.migrations_table).toBe('d1_migrations')
  })

  it('runs unit tests under the compatibility flags that are deployed', () => {
    expect(config.compatibility_flags).toEqual(['nodejs_compat', 'no_nodejs_compat_v2'])
    expect(vitestConfig).toContain("compatibilityFlags: ['nodejs_compat', 'no_nodejs_compat_v2']")
  })
})

describe('package scripts', () => {
  it('never use drizzle-kit to apply or drop anything (Wrangler runs migrations)', () => {
    for (const script of Object.values(packageJson.scripts)) {
      expect(script).not.toMatch(/\bdrizzle-kit\b.*\b(push|migrate|drop|up)\b/)
    }
  })

  it('migrate the local database with Wrangler and the hand-kept config', () => {
    expect(packageJson.scripts['db:migrate:local']).toBe(
      'wrangler d1 migrations apply DB --local --config wrangler.jsonc',
    )
  })
})
