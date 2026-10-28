import { describe, expect, it } from 'vitest'
import wranglerConfig from '../../../wrangler.jsonc?raw'
import { parseJsonc } from '../helpers/jsonc'

// The admin guard fails closed when ACCESS_TEAM_DOMAIN or ACCESS_AUD is
// missing, so a deployed environment without them answers every admin
// request with 403 (#125). Previews don't inherit production vars, so each
// level is checked on its own.

interface Level {
  vars?: Record<string, string>
  previews?: Level
}

const config = parseJsonc(wranglerConfig) as { env: Record<string, Level> }

const levels: [string, Level | undefined][] = Object.entries(config.env).flatMap(
  ([name, level]) => [
    [name, level],
    [`${name} Previews`, level.previews],
  ],
)

describe('Access settings for the admin guard', () => {
  it('cover the deployed environments we expect', () => {
    // Remove `staging` and `staging Previews` here when the old staging
    // Worker is retired (docs/deploys.md, step 6).
    expect(levels.map(([name]) => name)).toEqual(
      expect.arrayContaining(['live', 'live Previews', 'staging', 'staging Previews']),
    )
  })

  it.each(levels)('are set in %s', (_name, level) => {
    expect(level?.vars?.ACCESS_TEAM_DOMAIN).toBe('kinmeet.cloudflareaccess.com')
    expect(level?.vars?.ACCESS_AUD).toMatch(/^[0-9a-f]{64}$/)
  })

  it('give every environment its own Access application', () => {
    const auds = levels.map(([, level]) => level?.vars?.ACCESS_AUD)
    expect(new Set(auds).size).toBe(auds.length)
  })
})
