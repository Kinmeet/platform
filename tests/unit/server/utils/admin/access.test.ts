import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearAccessKeyCache, verifyAccessToken } from '../../../../../server/utils/admin/access'
import { AUD, NOW, TEAM, certsFetcher, makeKey, signToken } from './access-token'

let key: Awaited<ReturnType<typeof makeKey>>
let otherKey: Awaited<ReturnType<typeof makeKey>>
const config = { teamDomain: TEAM, audience: AUD }

beforeAll(async () => {
  key = await makeKey('key-1')
  otherKey = await makeKey('key-2')
})

beforeEach(() => clearAccessKeyCache())
afterEach(() => vi.useRealTimers())

const verify = (token: string | null, fetcher = certsFetcher([key.jwk]), now = NOW) =>
  verifyAccessToken(token, config, { fetcher, now })

describe('verifyAccessToken', () => {
  it('accepts a valid token and returns only the opaque user id', async () => {
    const calls: string[] = []
    expect(await verify(await signToken(key), certsFetcher([key.jwk], calls))).toEqual({
      sub: '00000000-0000-4000-8000-00000000f00d',
    })
    expect(calls).toEqual([`https://${TEAM}/cdn-cgi/access/certs`])
  })

  it('refuses a missing or malformed token', async () => {
    for (const token of [null, '', 'abc', 'a.b', 'a.b.c', `${await signToken(key)}.extra`]) {
      expect(await verify(token)).toBeNull()
    }
  })

  it('refuses a token for another application or team', async () => {
    expect(await verify(await signToken(key, { aud: ['other-audience'] }))).toBeNull()
    expect(
      await verify(await signToken(key, { iss: 'https://other.cloudflareaccess.com' })),
    ).toBeNull()
  })

  it('refuses an expired or not-yet-valid token, allowing a minute of clock skew', async () => {
    expect(await verify(await signToken(key, { exp: NOW - 61 }))).toBeNull()
    expect(await verify(await signToken(key, { exp: NOW - 30 }))).not.toBeNull()
    expect(await verify(await signToken(key, { nbf: NOW + 61 }))).toBeNull()
    expect(await verify(await signToken(key, { exp: undefined }))).toBeNull()
  })

  it('refuses a token signed by a key the team does not publish', async () => {
    expect(await verify(await signToken(otherKey))).toBeNull()
    // A forged kid pointing at a published key still fails the signature.
    expect(await verify(await signToken(otherKey, {}, { kid: 'key-1' }))).toBeNull()
  })

  it('refuses other algorithms, including none', async () => {
    const token = await signToken(key)
    const [, body, signature] = token.split('.')
    for (const alg of ['none', 'HS256', 'RS512']) {
      const head = btoa(JSON.stringify({ alg, kid: 'key-1' })).replace(/=+$/, '')
      expect(await verify(`${head}.${body}.${signature}`)).toBeNull()
    }
  })

  it('refuses a token with no user id, as service tokens have', async () => {
    expect(await verify(await signToken(key, { sub: '' }))).toBeNull()
  })

  it('fetches the keys again once when a new kid appears', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const calls: string[] = []
    let keys = [key.jwk]
    const fetcher = (async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify({ keys }))
    }) as typeof fetch
    expect(await verify(await signToken(key), fetcher)).not.toBeNull()
    keys = [key.jwk, otherKey.jwk]
    vi.advanceTimersByTime(61 * 1000)
    expect(await verify(await signToken(otherKey), fetcher)).not.toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('looks again for an unknown kid at most once a minute (Theo, #51)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const calls: string[] = []
    const fetcher = certsFetcher([key.jwk], calls)
    expect(await verify(await signToken(key), fetcher)).not.toBeNull()
    // Tokens naming kids we have never seen, as an attacker could send.
    for (let i = 0; i < 5; i++) {
      expect(
        await verify(await signToken(otherKey, {}, { kid: `made-up-${i}` }), fetcher),
      ).toBeNull()
    }
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(61 * 1000)
    expect(await verify(await signToken(otherKey, {}, { kid: 'made-up-late' }), fetcher)).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it('fails closed without configuration or with an unexpected team domain', async () => {
    const token = await signToken(key)
    const fetcher = certsFetcher([key.jwk])
    expect(
      await verifyAccessToken(token, { teamDomain: '', audience: AUD }, { fetcher, now: NOW }),
    ).toBeNull()
    expect(
      await verifyAccessToken(token, { teamDomain: TEAM, audience: '' }, { fetcher, now: NOW }),
    ).toBeNull()
    expect(
      await verifyAccessToken(
        token,
        { teamDomain: 'example.com', audience: AUD },
        { fetcher, now: NOW },
      ),
    ).toBeNull()
  })

  it('throws when the keys cannot be fetched, so the caller refuses', async () => {
    const down = (async () => new Response('down', { status: 500 })) as unknown as typeof fetch
    await expect(verify(await signToken(key), down)).rejects.toThrow('access_keys_unavailable')
  })
})
