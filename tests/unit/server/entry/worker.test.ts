import { describe, expect, it, vi } from 'vitest'
import { withBodyLimits } from '../../../../server/entry/worker'

const ORIGIN = 'https://platform-staging.kinmeet.workers.dev'

function fakeNitro() {
  return {
    fetch: vi.fn(async () => new Response('from nitro')),
    scheduled: vi.fn(async () => undefined),
  }
}

describe('Worker entry', () => {
  it('passes the scheduled handler through untouched, for the deletion job', async () => {
    const nitro = fakeNitro()
    const entry = withBodyLimits(nitro)
    expect(entry.scheduled).toBe(nitro.scheduled)

    const controller = { cron: '0 3 * * *', scheduledTime: 0, noRetry() {} }
    await entry.scheduled(controller, {}, {})
    expect(nitro.scheduled).toHaveBeenCalledWith(controller, {}, {})
  })

  it('hands an accepted request to Nitro with the same env and context', async () => {
    const nitro = fakeNitro()
    const env = { KINMEET_ENV: 'test' }
    const ctx = { waitUntil() {} }
    const response = await withBodyLimits(nitro).fetch(new Request(`${ORIGIN}/`), env, ctx)
    expect(await response.text()).toBe('from nitro')
    expect(nitro.fetch).toHaveBeenCalledOnce()
    expect(nitro.fetch.mock.calls[0]?.[1]).toBe(env)
    expect(nitro.fetch.mock.calls[0]?.[2]).toBe(ctx)
  })

  it('never calls Nitro for an oversized body', async () => {
    const nitro = fakeNitro()
    const request = new Request(`${ORIGIN}/api/hello`, {
      method: 'POST',
      body: new Uint8Array(23 * 1024),
    })
    const response = await withBodyLimits(nitro).fetch(request, {}, {})
    expect(response.status).toBe(413)
    expect(nitro.fetch).not.toHaveBeenCalled()
  })
})
