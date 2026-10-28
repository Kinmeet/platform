import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { markOutcomeTold, markReplied } from '../../../../../server/utils/db/admin'
import { deleteExpiredRows } from '../../../../../server/utils/db/deletion'
import {
  findForm,
  formSubmissionExists,
  insertFormSubmission,
  type StoredForm,
} from '../../../../../server/utils/db/forms'
import {
  addMonths,
  applicationDeleteAfterOutcome,
  applicationDeleteAfterReceipt,
  helloDeleteAfterReceipt,
  helloDeleteAfterReply,
} from '../../../../../server/utils/retention'
import { purposes } from '../../../../../shared/privacy/purposes'

// Storage on `form_submissions` (ADR-0010, #156), and the deletion job for
// each seeded P3 purpose. Made-up test data only.
const NOW = 1_793_000_000
const DAY = 24 * 60 * 60
const ACTOR = '00000000-0000-4000-8000-00000000f00d'

const message = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

const application = {
  submissionId: '4a2d3c0b-7e5f-4b8c-8d3e-2f6a7b8c9d0e',
  role: 'trustee',
  checks: { over_18: 'yes', connection_to_founders: 'no', trustee_rules_confirmed: 'yes' },
  callName: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: { why_trustee: 'A made-up reason.' },
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

let hello: StoredForm
let trustee: StoredForm

async function rows() {
  const { results } = await env.DB.prepare(
    'SELECT * FROM form_submissions ORDER BY received_at, id',
  ).all<Record<string, unknown>>()
  return results
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM form_submissions'),
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM applications'),
  ])
  hello = (await findForm(env.DB, 'hello'))!
  trustee = (await findForm(env.DB, 'trustee'))!
})

describe('storing a submission', () => {
  it('stores a message with a deletion date 12 months after receipt, and nothing else', async () => {
    expect(await insertFormSubmission(env.DB, hello, message, { roundClosesAt: 0, now: NOW })).toBe(
      'stored',
    )
    const [row, ...others] = await rows()
    expect(others).toEqual([])
    expect(row).toMatchObject({
      submission_id: message.submissionId,
      form_id: hello.id,
      version: 1,
      call_name: 'Test Fox',
      email: 'test.fox@example.com',
      answers: JSON.stringify({ message: 'Hello from a made-up test.' }),
      received_at: NOW,
      replied_at: null,
      outcome_told_at: null,
      delete_after: helloDeleteAfterReceipt(NOW),
    })
    expect(JSON.stringify(row)).not.toContain(message.turnstileToken)
  })

  it('stores a repeated submission id only once, keeping the first message', async () => {
    await insertFormSubmission(env.DB, hello, message, { roundClosesAt: 0, now: NOW })
    expect(
      await insertFormSubmission(
        env.DB,
        hello,
        { ...message, message: 'Different text.' },
        { roundClosesAt: 0, now: NOW + 5 },
      ),
    ).toBe('duplicate')
    expect((await rows()).map((row) => JSON.parse(String(row.answers)))).toEqual([
      { message: 'Hello from a made-up test.' },
    ])
  })

  it('finds stored submission ids only', async () => {
    expect(await formSubmissionExists(env.DB, message.submissionId)).toBe(false)
    await insertFormSubmission(env.DB, hello, message, { roundClosesAt: 0, now: NOW })
    expect(await formSubmissionExists(env.DB, message.submissionId)).toBe(true)
  })

  it('stores an application with the round-close backstop, or receipt if later', async () => {
    const closes = NOW + 90 * DAY
    await insertFormSubmission(env.DB, trustee, application, { roundClosesAt: closes, now: NOW })
    await insertFormSubmission(
      env.DB,
      trustee,
      { ...application, submissionId: crypto.randomUUID() },
      { roundClosesAt: NOW - DAY, now: NOW + 1 },
    )
    const [first, second] = await rows()
    expect(first!.delete_after).toBe(applicationDeleteAfterReceipt(NOW, closes))
    expect(first!.delete_after).toBe(addMonths(closes, 6))
    expect(second!.delete_after).toBe(applicationDeleteAfterReceipt(NOW + 1, NOW - DAY))
    expect(JSON.parse(String(first!.answers))).toEqual({
      connection_to_founders: 'no',
      why_trustee: 'A made-up reason.',
    })
  })

  it('refuses to store on a form that is not open', async () => {
    const closed = { ...hello, status: 'closed' as const }
    await expect(
      insertFormSubmission(env.DB, closed, message, { roundClosesAt: 0, now: NOW }),
    ).rejects.toThrow('form_not_open')
    expect(await rows()).toEqual([])
  })

  it('never uses a stored version that breaks the definition rules', async () => {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, 'sample-form', 'form', 'draft', 1)`,
      ).bind(id),
      env.DB.prepare(
        `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
         VALUES (?, 1, 'say_hello', '{"steps":[],"aboutYou":0}', '{}', 1, 'test-actor')`,
      ).bind(id),
      env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
    ])
    await expect(findForm(env.DB, 'sample-form')).rejects.toThrow('form_version_invalid')
  })
})

describe('retention for each seeded purpose (P3)', () => {
  it('say hello: deleted 12 months after receipt when never answered', async () => {
    await insertFormSubmission(env.DB, hello, message, { roundClosesAt: 0, now: NOW })
    const due = addMonths(NOW, purposes.say_hello.retention.months)
    expect((await deleteExpiredRows(env.DB, due - 1)).form_submissions).toBe(0)
    expect((await deleteExpiredRows(env.DB, due)).form_submissions).toBe(1)
    expect(await rows()).toEqual([])
  })

  it('say hello: kept until 12 months after the last reply', async () => {
    await insertFormSubmission(env.DB, hello, message, { roundClosesAt: 0, now: NOW })
    const [row] = await rows()
    const replied = NOW + 300 * DAY
    expect(await markReplied(env.DB, String(row!.id), ACTOR, replied)).toBe(true)
    expect((await rows())[0]!.delete_after).toBe(helloDeleteAfterReply(replied))
    expect((await deleteExpiredRows(env.DB, helloDeleteAfterReceipt(NOW))).form_submissions).toBe(0)
    expect((await deleteExpiredRows(env.DB, helloDeleteAfterReply(replied))).form_submissions).toBe(
      1,
    )
  })

  it('trustee application: deleted at the backstop when no outcome is told', async () => {
    const closes = NOW + 30 * DAY
    await insertFormSubmission(env.DB, trustee, application, { roundClosesAt: closes, now: NOW })
    const due = applicationDeleteAfterReceipt(NOW, closes)
    expect((await deleteExpiredRows(env.DB, due - 1)).form_submissions).toBe(0)
    expect((await deleteExpiredRows(env.DB, due)).form_submissions).toBe(1)
  })

  it('trustee application: kept until 6 months after the outcome is told', async () => {
    await insertFormSubmission(env.DB, trustee, application, { roundClosesAt: 0, now: NOW })
    const [row] = await rows()
    const told = NOW + 100 * DAY
    expect(await markOutcomeTold(env.DB, String(row!.id), ACTOR, told)).toBe(true)
    const due = applicationDeleteAfterOutcome(told)
    expect((await rows())[0]!.delete_after).toBe(due)
    expect((await deleteExpiredRows(env.DB, due - 1)).form_submissions).toBe(0)
    expect((await deleteExpiredRows(env.DB, due)).form_submissions).toBe(1)
  })

  it('moves the old copy of a row on too, so it is never kept longer', async () => {
    // A row from before the migration sits in both tables until phase C.
    const id = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email,
                                 answers, received_at, delete_after)
       VALUES (?, ?, 'trustee', 'no', 'Sample Applicant', 'sample@example.org', '{}', ?, ?)`,
    )
      .bind(id, crypto.randomUUID(), NOW, addMonths(NOW, 9))
      .run()
    const told = NOW + DAY
    expect(await markOutcomeTold(env.DB, id, ACTOR, told)).toBe(true)
    const legacy = await env.DB.prepare(
      'SELECT outcome_told_at, delete_after FROM applications WHERE id = ?',
    )
      .bind(id)
      .first()
    expect(legacy).toEqual({
      outcome_told_at: told,
      delete_after: applicationDeleteAfterOutcome(told),
    })
    const counts = await deleteExpiredRows(env.DB, applicationDeleteAfterOutcome(told))
    expect(counts).toMatchObject({ form_submissions: 1, applications: 1 })
  })
})
