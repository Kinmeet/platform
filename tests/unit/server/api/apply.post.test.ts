import { env } from 'cloudflare:test'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import applyHandler, { roundClosesAt } from '../../../../server/api/apply.post'
import type { RateLimiter } from '../../../../server/utils/forms/rate-limit'
import { applicationDeleteAfterReceipt, addMonths } from '../../../../server/utils/retention'
import { definitionSchema } from '../../../../shared/forms/definition'
import { bodyCapFor } from '../../../../shared/forms/runtime'
import { bodyLimitFor } from '../../../../shared/routes'

// Made-up test data and Cloudflare's documented dummy Turnstile values.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const HOST = 'kinmeet-staging.kinmeet.workers.dev'
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  role: 'trustee',
  checks: { over_18: 'yes', connection_to_founders: 'not_sure', trustee_rules_confirmed: 'yes' },
  callName: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: { why_trustee: 'A made-up reason.', experience: '' },
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

const allow: RateLimiter = { limit: async () => ({ success: true }) }
const waited: Promise<unknown>[] = []

function call(body: unknown, extraEnv: Record<string, unknown> = {}) {
  const app = createApp()
  // Nitro gives each event a waitUntil; plain h3 does not.
  app.use(
    defineEventHandler((event) => {
      event.waitUntil = (promise: Promise<unknown>) => waited.push(promise)
    }),
  )
  app.use('/api/apply', applyHandler)
  return toWebHandler(app)(
    new Request(`${ORIGIN}/api/apply`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10',
      },
      body: JSON.stringify(body),
    }),
    {
      cloudflare: {
        env: {
          DB: env.DB,
          SITE_ORIGIN: ORIGIN,
          KINMEET_ENV: 'staging',
          TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
          RATE_LIMIT_HMAC_KEY: 'test-only-hmac-key',
          EMAIL_LOG_HMAC_KEY: 'test-only-email-key',
          FORM_RATE_LIMITER: allow,
          FORM_GLOBAL_RATE_LIMITER: allow,
          ...extraEnv,
        },
      },
    },
  )
}

let siteverify: { success: boolean; hostname?: string; action?: string }
const logs: string[] = []

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM form_submissions'),
    env.DB.prepare('DELETE FROM email_log'),
  ])
  siteverify = { success: true, hostname: HOST, action: 'apply' }
  logs.length = 0
  waited.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(siteverify)),
  )
  for (const level of ['error', 'warn', 'info', 'log'] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => {
      logs.push(String(line))
    })
  }
})

afterEach(async () => {
  await Promise.allSettled(waited)
  vi.restoreAllMocks()
})

// Applications are stored on their role's form (ADR-0010, #156). Every row in
// `form_submissions` is returned, so a row on the wrong form still counts,
// and the old table must stay empty.
async function rows() {
  const legacy = await env.DB.prepare('SELECT count(*) AS n FROM applications').first<{
    n: number
  }>()
  expect(legacy!.n).toBe(0)
  const { results } = await env.DB.prepare(
    `SELECT s.*, f.slug AS form_slug FROM form_submissions AS s
     LEFT JOIN forms AS f ON f.id = s.form_id`,
  ).all<Record<string, unknown>>()
  return results
}

async function emailLogCount() {
  return (await env.DB.prepare('SELECT count(*) AS n FROM email_log').first<{ n: number }>())!.n
}

describe('POST /api/apply', () => {
  it('stores the application with only the P3 fields and queues the receipt', async () => {
    const response = await call(valid)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true, receipt: 'queued' })
    const [row, ...others] = await rows()
    expect(others).toEqual([])
    expect(Object.keys(row!).sort()).toEqual(
      [
        'answers',
        'call_name',
        'delete_after',
        'email',
        'form_id',
        'form_slug',
        'id',
        'outcome_told_at',
        'received_at',
        'replied_at',
        'submission_id',
        'version',
      ].sort(),
    )
    expect(row).toMatchObject({
      form_slug: 'trustee',
      version: 2, // the trustee form is on version 2 since 0007
      call_name: 'Sample Applicant',
      email: 'sample.applicant@example.org',
      replied_at: null,
      outcome_told_at: null,
    })
    // Of the checks, only the founder-connection answer is kept, and the
    // empty optional answer is not kept.
    expect(JSON.parse(String(row!.answers))).toEqual({
      connection_to_founders: 'not_sure',
      why_trustee: 'A made-up reason.',
    })
    expect(await emailLogCount()).toBe(1)
  })

  it('sets the backstop deletion date from the round close, or receipt if later', async () => {
    await call(valid)
    const [first] = await rows()
    const receivedAt = Number(first!.received_at)
    expect(first!.delete_after).toBe(addMonths(receivedAt, 6))

    await env.DB.prepare('DELETE FROM form_submissions').run()
    const closes = receivedAt + 90 * 24 * 60 * 60
    await call(valid, { APPLY_ROUND_CLOSES_AT: String(closes) })
    const [second] = await rows()
    expect(second!.delete_after).toBe(
      applicationDeleteAfterReceipt(Number(second!.received_at), closes),
    )
  })

  it('reads the round close date strictly', () => {
    expect(roundClosesAt(undefined)).toBe(0)
    expect(roundClosesAt({ APPLY_ROUND_CLOSES_AT: '' })).toBe(0)
    expect(roundClosesAt({ APPLY_ROUND_CLOSES_AT: 'soon' })).toBe(0)
    expect(roundClosesAt({ APPLY_ROUND_CLOSES_AT: '-5' })).toBe(0)
    expect(roundClosesAt({ APPLY_ROUND_CLOSES_AT: '1800000000' })).toBe(1_800_000_000)
  })

  it('answers a retry with 200, stores nothing new and sends no second receipt', async () => {
    await call(valid)
    const response = await call({ ...valid, callName: 'Another Made-up Name' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, receipt: 'not_requested' })
    expect(await rows()).toHaveLength(1)
    expect(await emailLogCount()).toBe(1)
  })

  it('refuses under-18s and applicants who are not independent, storing nothing', async () => {
    for (const checks of [
      { ...valid.checks, over_18: 'no' },
      { ...valid.checks, connection_to_founders: 'related_or_household' },
    ]) {
      const response = await call({ ...valid, checks })
      expect(response.status).toBe(422)
    }
    expect(await rows()).toEqual([])
    expect(await emailLogCount()).toBe(0)
  })

  it('refuses a closed role with role_closed', async () => {
    const response = await call({ ...valid, role: 'treasurer' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      ok: false,
      errors: [{ field: 'role', code: 'role_closed' }],
    })
  })

  it('checks the apply action, so a say hello token cannot be spent here', async () => {
    siteverify = { success: true, hostname: HOST, action: 'hello' }
    expect((await call(valid)).status).toBe(403)
    expect(await rows()).toEqual([])
  })

  it('still stores the application when the receipt cannot be sent', async () => {
    const response = await call(valid, { EMAIL_LOG_HMAC_KEY: undefined })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true, receipt: 'not_requested' })
    expect(await rows()).toHaveLength(1)
  })

  it('never logs anything the applicant typed', async () => {
    await call(valid)
    await call({ ...valid, email: 'not-an-email' })
    await Promise.allSettled(waited)
    const text = logs.join('\n')
    for (const value of ['Sample Applicant', 'sample.applicant', 'A made-up reason.']) {
      expect(text).not.toContain(value)
    }
  })
})

describe('the apply body caps', () => {
  // Nadia, #80: the Worker entry refuses a body over the route's entry limit
  // before Nitro reads it, so the schema's own cap must fit inside it, or a
  // valid application could be refused with 413 before the route sees it.
  it('keeps the schema cap within the entry limit', async () => {
    const row = await env.DB.prepare(
      `SELECT v.definition FROM forms AS f
       JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version
       WHERE f.slug = 'trustee'`,
    ).first<{ definition: string }>()
    const cap = bodyCapFor(definitionSchema.parse(JSON.parse(row!.definition)), 'application')
    expect(cap).toBeGreaterThan(0)
    expect(cap).toBeLessThanOrEqual(bodyLimitFor('POST', '/api/apply'))
  })
})
