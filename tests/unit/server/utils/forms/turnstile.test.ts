import { describe, expect, it } from 'vitest'
import { SITEVERIFY_URL, verifyTurnstile } from '../../../../../server/utils/forms/turnstile'

// Cloudflare's documented dummy values, never real ones.
const SECRET = '1x0000000000000000000000000000000AA'
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'
const HOST = 'kinmeet-staging.kinmeet.workers.dev'

function fakeFetch(response: Response | Error) {
  const calls: { url: string; body: FormData }[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body as FormData })
    if (response instanceof Error) throw response
    return response
  }) as typeof fetch
  return { fetcher, calls }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const verify = (
  response: Response | Error,
  overrides: { secret?: string; token?: string } = {},
) => {
  const fake = fakeFetch(response)
  return {
    calls: fake.calls,
    result: verifyTurnstile({
      secret: SECRET,
      token: TOKEN,
      hostnameAllowed: (hostname: string) => hostname === HOST,
      expectedAction: 'hello',
      fetcher: fake.fetcher,
      ...overrides,
    }),
  }
}

describe('verifyTurnstile', () => {
  it('passes a good token and sends only the secret and the token, never remoteip', async () => {
    const { result, calls } = verify(json({ success: true, hostname: HOST, action: 'hello' }))
    expect(await result).toBe('passed')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(SITEVERIFY_URL)
    expect([...calls[0]!.body.keys()].sort()).toEqual(['response', 'secret'])
    expect(calls[0]!.body.get('response')).toBe(TOKEN)
  })

  it('fails when Turnstile says no', async () => {
    expect(await verify(json({ success: false, hostname: HOST, action: 'hello' })).result).toBe(
      'failed',
    )
  })

  it('fails a token issued for another hostname or form', async () => {
    expect(
      await verify(json({ success: true, hostname: 'example.org', action: 'hello' })).result,
    ).toBe('failed')
    expect(await verify(json({ success: true, hostname: HOST, action: 'apply' })).result).toBe(
      'failed',
    )
    expect(await verify(json({ success: true, hostname: HOST })).result).toBe('failed')
  })

  it('fails an empty token without calling Turnstile', async () => {
    const { result, calls } = verify(json({ success: true }), { token: '' })
    expect(await result).toBe('failed')
    expect(calls).toHaveLength(0)
  })

  it('fails closed when Turnstile cannot be reached or answers badly', async () => {
    expect(await verify(new Error('down')).result).toBe('unavailable')
    expect(await verify(new Response('oops', { status: 500 })).result).toBe('unavailable')
    expect(await verify(new Response('not json')).result).toBe('unavailable')
    expect(await verify(json({ success: true }), { secret: '' }).result).toBe('unavailable')
  })
})
