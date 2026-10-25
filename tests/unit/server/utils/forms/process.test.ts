import { describe, expect, it } from 'vitest'
import { helloSchema, type HelloSubmission } from '../../../../../shared/forms/hello'
import {
  processFormSubmission,
  type FormSubmissionSteps,
} from '../../../../../server/utils/forms/process'
import type { TurnstileResult } from '../../../../../server/utils/forms/turnstile'

// Made-up test data only.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'A made-up secret-looking message 12345.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/hello`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function harness(
  options: { rateOk?: boolean; turnstile?: TurnstileResult; storeFails?: boolean } = {},
) {
  const stored = new Map<string, HelloSubmission>()
  const calls: string[] = []
  const logs: string[] = []
  const steps: FormSubmissionSteps<typeof helloSchema> = {
    form: 'hello',
    schema: helloSchema,
    receipt: 'not_requested',
    withinRateLimit: async () => {
      calls.push('rate')
      return options.rateOk ?? true
    },
    verifyTurnstile: async () => {
      calls.push('turnstile')
      return options.turnstile ?? 'passed'
    },
    exists: async (id) => {
      calls.push('exists')
      return stored.has(id)
    },
    store: async (submission) => {
      calls.push('store')
      if (options.storeFails) throw new Error(`D1 failed for ${submission.email}`)
      if (stored.has(submission.submissionId)) return 'duplicate'
      stored.set(submission.submissionId, submission)
      return 'stored'
    },
    afterStore: async () => {
      calls.push('after')
    },
    log: (code) => logs.push(code),
  }
  return { steps, stored, calls, logs }
}

describe('processFormSubmission', () => {
  it('stores a valid submission and answers 201', async () => {
    const h = harness()
    const response = await processFormSubmission(post(valid), h.steps)
    expect(response).toEqual({ status: 201, body: { ok: true, receipt: 'not_requested' } })
    expect(h.calls).toEqual(['rate', 'turnstile', 'exists', 'store', 'after'])
    expect(h.stored.size).toBe(1)
  })

  it('replays a repeated submission id with 200, storing nothing new even if the body differs', async () => {
    const h = harness()
    await processFormSubmission(post(valid), h.steps)
    h.calls.length = 0
    const response = await processFormSubmission(
      post({ ...valid, message: 'Different made-up text.' }),
      h.steps,
    )
    expect(response).toEqual({ status: 200, body: { ok: true, receipt: 'not_requested' } })
    expect(h.calls).toEqual(['rate', 'turnstile', 'exists'])
    expect(h.stored.get(valid.submissionId)?.message).toBe(valid.message)
  })

  it('treats losing a race on the same id as a repeat, without after-store work', async () => {
    const h = harness()
    h.stored.set(valid.submissionId, helloSchema.parse(valid))
    h.steps.exists = async () => false
    const response = await processFormSubmission(post(valid), h.steps)
    expect(response.status).toBe(200)
    expect(h.calls).not.toContain('after')
  })

  it('verifies Turnstile before validating or looking anything up', async () => {
    const h = harness({ turnstile: 'failed' })
    const response = await processFormSubmission(post({ ...valid, email: 'bad' }), h.steps)
    expect(response).toEqual({
      status: 403,
      body: { ok: false, errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }] },
    })
    expect(h.calls).toEqual(['rate', 'turnstile'])
  })

  it('answers turnstile_failed for a missing token without calling Turnstile', async () => {
    const h = harness()
    const { turnstileToken: _token, ...withoutToken } = valid
    expect((await processFormSubmission(post(withoutToken), h.steps)).status).toBe(403)
    expect(h.calls).toEqual(['rate'])
  })

  it('answers 503 when Turnstile cannot be reached', async () => {
    const h = harness({ turnstile: 'unavailable' })
    expect(await processFormSubmission(post(valid), h.steps)).toEqual({
      status: 503,
      body: { ok: false, error: 'unavailable' },
    })
    expect(h.logs).toEqual(['hello_turnstile_unavailable'])
  })

  it('answers 422 with field codes and stores nothing', async () => {
    const h = harness()
    const response = await processFormSubmission(
      post({ ...valid, email: 'bad', callName: '' }),
      h.steps,
    )
    expect(response).toEqual({
      status: 422,
      body: {
        ok: false,
        errors: [
          { field: 'callName', code: 'required' },
          { field: 'email', code: 'invalid_email' },
        ],
      },
    })
    expect(h.stored.size).toBe(0)
  })

  it('answers 429 when rate limited, before reading the body', async () => {
    const h = harness({ rateOk: false })
    expect(await processFormSubmission(post(valid), h.steps)).toEqual({
      status: 429,
      body: { ok: false, error: 'rate_limited', retryAfter: 60 },
    })
    expect(h.calls).toEqual(['rate'])
  })

  it('answers 400 for another origin without touching the limiter', async () => {
    const h = harness()
    const response = await processFormSubmission(
      post(valid, { Origin: 'https://example.com' }),
      h.steps,
    )
    expect(response).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } })
    expect(h.calls).toEqual([])
  })

  it('answers 400 for invalid JSON or a malformed submission id', async () => {
    expect((await processFormSubmission(post('{not json'), harness().steps)).status).toBe(400)
    expect(
      (await processFormSubmission(post({ ...valid, submissionId: 'abc' }), harness().steps))
        .status,
    ).toBe(400)
  })

  it('answers 503 when storing fails, and logs a code only', async () => {
    const h = harness({ storeFails: true })
    expect((await processFormSubmission(post(valid), h.steps)).status).toBe(503)
    expect(h.logs).toEqual(['hello_unavailable'])
  })

  it('never logs anything from the request', async () => {
    const h = harness({ storeFails: true })
    await processFormSubmission(post(valid), h.steps)
    await processFormSubmission(post({ ...valid, email: 'bad' }), harness().steps)
    await processFormSubmission(post('{not json'), h.steps)
    const logged = h.logs.join('\n')
    for (const value of [
      valid.callName,
      valid.email,
      valid.message,
      valid.turnstileToken,
      valid.submissionId,
    ]) {
      expect(logged).not.toContain(value)
    }
    for (const code of h.logs) expect(code).toMatch(/^hello_[a-z_]+$/)
  })
})
