import { describe, expect, it } from 'vitest'
import { SITEVERIFY_URL, verifyTurnstile } from '../../../../../server/utils/forms/turnstile'

// Cloudflare's documented dummy values, never real ones.
const SECRET = '1x0000000000000000000000000000000AA'
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX'

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

describe('verifyTurnstile', () => {
  it('sends only the secret and the token, never remoteip', async () => {
    const { fetcher, calls } = fakeFetch(json({ success: true, hostname: 'example.com' }))
    expect(await verifyTurnstile({ secret: SECRET, token: TOKEN, fetcher })).toBe('passed')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(SITEVERIFY_URL)
    expect([...calls[0]!.body.keys()].sort()).toEqual(['response', 'secret'])
    expect(calls[0]!.body.get('response')).toBe(TOKEN)
  })

  it('fails when Turnstile says no', async () => {
    const { fetcher } = fakeFetch(
      json({ success: false, 'error-codes': ['invalid-input-response'] }),
    )
    expect(await verifyTurnstile({ secret: SECRET, token: TOKEN, fetcher })).toBe('failed')
  })

  it('fails when the token was issued for another hostname', async () => {
    const { fetcher } = fakeFetch(json({ success: true, hostname: 'example.org' }))
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        expectedHostname: 'example.com',
        fetcher,
      }),
    ).toBe('failed')
  })

  it('fails an empty token without calling Turnstile', async () => {
    const { fetcher, calls } = fakeFetch(json({ success: true }))
    expect(await verifyTurnstile({ secret: SECRET, token: '', fetcher })).toBe('failed')
    expect(calls).toHaveLength(0)
  })

  it('is unavailable when Turnstile cannot be reached or answers badly', async () => {
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        fetcher: fakeFetch(new Error('down')).fetcher,
      }),
    ).toBe('unavailable')
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        fetcher: fakeFetch(new Response('oops', { status: 500 })).fetcher,
      }),
    ).toBe('unavailable')
    expect(
      await verifyTurnstile({
        secret: SECRET,
        token: TOKEN,
        fetcher: fakeFetch(new Response('not json')).fetcher,
      }),
    ).toBe('unavailable')
    expect(
      await verifyTurnstile({
        secret: '',
        token: TOKEN,
        fetcher: fakeFetch(json({ success: true })).fetcher,
      }),
    ).toBe('unavailable')
  })
})
