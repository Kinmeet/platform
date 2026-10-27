import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  helloMessageExists,
  insertHelloMessage,
} from '../../../../../server/utils/db/hello-messages'
import { helloDeleteAfterReceipt } from '../../../../../server/utils/retention'

// Made-up test data only.
const submission = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}
const NOW = 1_793_000_000

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM hello_messages').run()
})

describe('hello_messages storage', () => {
  it('stores a message with a deletion date 12 months after receipt, and nothing else', async () => {
    expect(await insertHelloMessage(env.DB, submission, NOW)).toBe('stored')
    const row = await env.DB.prepare('SELECT * FROM hello_messages').first<
      Record<string, unknown>
    >()
    expect(row).toMatchObject({
      submission_id: submission.submissionId,
      call_name: 'Test Fox',
      email: 'test.fox@example.com',
      message: 'Hello from a made-up test.',
      received_at: NOW,
      replied_at: null,
      delete_after: helloDeleteAfterReceipt(NOW),
    })
    expect(JSON.stringify(row)).not.toContain(submission.turnstileToken)
  })

  it('stores a repeated submission id only once, keeping the first message', async () => {
    await insertHelloMessage(env.DB, submission, NOW)
    expect(
      await insertHelloMessage(env.DB, { ...submission, message: 'Different text.' }, NOW + 5),
    ).toBe('duplicate')
    const { results } = await env.DB.prepare('SELECT message FROM hello_messages').all<{
      message: string
    }>()
    expect(results).toEqual([{ message: 'Hello from a made-up test.' }])
  })

  it('finds stored submission ids only', async () => {
    expect(await helloMessageExists(env.DB, submission.submissionId)).toBe(false)
    await insertHelloMessage(env.DB, submission, NOW)
    expect(await helloMessageExists(env.DB, submission.submissionId)).toBe(true)
  })
})
