import { describe, expect, it } from 'vitest'
import { hostnameAllowed, originAllowed } from '../../../../../server/utils/forms/site-origin'

const STAGING = {
  siteOrigin: 'https://kinmeet-staging.kinmeet.workers.dev',
  environment: 'staging',
}
const LIVE = { siteOrigin: 'https://kinmeet-live.kinmeet.workers.dev', environment: 'live' }
const PREVIEW = {
  siteOrigin: 'https://*-kinmeet-staging.kinmeet.workers.dev',
  environment: 'preview',
}
const LOCAL = { siteOrigin: 'http://localhost:3000', environment: 'local' }

describe('originAllowed', () => {
  it('matches staging, live and local exactly', () => {
    expect(originAllowed('https://kinmeet-staging.kinmeet.workers.dev', STAGING)).toBe(true)
    expect(originAllowed('https://kinmeet-live.kinmeet.workers.dev', LIVE)).toBe(true)
    expect(originAllowed('http://localhost:3000', LOCAL)).toBe(true)
  })

  it('refuses anything else outside Previews', () => {
    for (const origin of [
      'https://kinmeet-live.kinmeet.workers.dev',
      'https://kinmeet-staging.kinmeet.workers.dev/',
      'https://kinmeet-staging.kinmeet.workers.dev:443',
      'http://kinmeet-staging.kinmeet.workers.dev',
      'https://KINMEET-STAGING.kinmeet.workers.dev',
      'https://evil.kinmeet-staging.kinmeet.workers.dev',
      'https://kinmeet-staging.kinmeet.workers.dev.example.com',
      'http://localhost:3001',
    ]) {
      expect(originAllowed(origin, STAGING)).toBe(false)
    }
  })

  it('refuses a missing or null origin', () => {
    expect(originAllowed(null, STAGING)).toBe(false)
    expect(originAllowed('null', STAGING)).toBe(false)
    expect(originAllowed('', STAGING)).toBe(false)
  })

  it('lets a Preview pattern match exactly one preview name', () => {
    expect(originAllowed('https://feature-123-kinmeet-staging.kinmeet.workers.dev', PREVIEW)).toBe(
      true,
    )
    expect(originAllowed('https://a-kinmeet-staging.kinmeet.workers.dev', PREVIEW)).toBe(true)
  })

  it('refuses a nested label, an empty label or a bad label in a Preview', () => {
    for (const origin of [
      'https://evil.feature-kinmeet-staging.kinmeet.workers.dev',
      'https://-kinmeet-staging.kinmeet.workers.dev',
      'https://kinmeet-staging.kinmeet.workers.dev',
      'https://feature_x-kinmeet-staging.kinmeet.workers.dev',
      'https://feature--kinmeet-staging.kinmeet.workers.dev',
      `https://${'a'.repeat(64)}-kinmeet-staging.kinmeet.workers.dev`,
      'http://feature-kinmeet-staging.kinmeet.workers.dev',
      'https://feature-kinmeet-staging.kinmeet.workers.dev.example.com',
      'https://feature-kinmeet-staging.kinmeet.workers.dev/path',
    ]) {
      expect(originAllowed(origin, PREVIEW)).toBe(false)
    }
  })

  it('never honours a wildcard outside Previews', () => {
    for (const environment of ['staging', 'live', 'local', undefined]) {
      const site = { siteOrigin: PREVIEW.siteOrigin, environment }
      expect(originAllowed('https://feature-kinmeet-staging.kinmeet.workers.dev', site)).toBe(false)
      expect(originAllowed('https://*-kinmeet-staging.kinmeet.workers.dev', site)).toBe(false)
    }
  })

  it('refuses patterns other than one leading wildcard', () => {
    for (const siteOrigin of [
      'https://*',
      'https://feature-*.kinmeet.workers.dev',
      'https://*-*-kinmeet-staging.kinmeet.workers.dev',
    ]) {
      const site = { siteOrigin, environment: 'preview' }
      expect(originAllowed('https://feature-kinmeet-staging.kinmeet.workers.dev', site)).toBe(false)
      expect(originAllowed('https://feature-x-kinmeet-staging.kinmeet.workers.dev', site)).toBe(
        false,
      )
    }
  })
})

describe('hostnameAllowed', () => {
  it('follows the same rules for the siteverify hostname', () => {
    expect(hostnameAllowed('kinmeet-staging.kinmeet.workers.dev', STAGING)).toBe(true)
    expect(hostnameAllowed('kinmeet-live.kinmeet.workers.dev', STAGING)).toBe(false)
    expect(hostnameAllowed('localhost', LOCAL)).toBe(true)
    expect(hostnameAllowed('feature-kinmeet-staging.kinmeet.workers.dev', PREVIEW)).toBe(true)
    expect(hostnameAllowed('a.feature-kinmeet-staging.kinmeet.workers.dev', PREVIEW)).toBe(false)
    expect(hostnameAllowed('-kinmeet-staging.kinmeet.workers.dev', PREVIEW)).toBe(false)
    expect(
      hostnameAllowed('feature-kinmeet-staging.kinmeet.workers.dev', {
        ...PREVIEW,
        environment: 'staging',
      }),
    ).toBe(false)
  })
})
