import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import nuxtConfig from '../../../../../nuxt.config.ts?raw'
import wranglerConfig from '../../../../../wrangler.jsonc?raw'
import { deleteExpiredRows } from '../../../../../server/utils/db/deletion'

// Made-up test data only.
const NOW = 1_800_000_000
const DAY = 24 * 60 * 60
const RECEIVED = NOW - 400 * DAY

let next = 0
const uuid = () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`

async function addHello(deleteAfter: number) {
  await env.DB.prepare(
    `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
     VALUES (?, ?, 'Test Fox', 'test.fox@example.com', 'Made-up message.', ?, ?)`,
  )
    .bind(uuid(), uuid(), RECEIVED, deleteAfter)
    .run()
}

async function addApplication(deleteAfter: number) {
  await env.DB.prepare(
    `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email, answers, received_at, delete_after)
     VALUES (?, ?, 'trustee', 'no', 'Sample Applicant', 'sample@example.org', '{}', ?, ?)`,
  )
    .bind(uuid(), uuid(), RECEIVED, deleteAfter)
    .run()
}

async function addEmailLog(deleteAfter: number) {
  await env.DB.prepare(
    `INSERT INTO email_log (id, to_hmac, template_id, sent_at, delete_after)
     VALUES (?, ?, 'application_receipt', ?, ?)`,
  )
    .bind(uuid(), 'b'.repeat(64), RECEIVED, deleteAfter)
    .run()
}

async function remaining(table: string): Promise<number[]> {
  const { results } = await env.DB.prepare(
    `SELECT delete_after FROM ${table} ORDER BY delete_after`,
  ).all<{
    delete_after: number
  }>()
  return results.map((row) => row.delete_after)
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM email_log'),
  ])
})

describe('deleteExpiredRows (retention)', () => {
  it('deletes rows past their date and leaves the others untouched, in every table', async () => {
    for (const add of [addHello, addApplication, addEmailLog]) {
      await add(NOW - DAY)
      await add(NOW)
      await add(NOW + 1)
      await add(NOW + 30 * DAY)
    }

    expect(await deleteExpiredRows(env.DB, NOW)).toEqual({
      hello_messages: 2,
      applications: 2,
      email_log: 2,
    })

    for (const table of ['hello_messages', 'applications', 'email_log']) {
      expect(await remaining(table)).toEqual([NOW + 1, NOW + 30 * DAY])
    }
  })

  it('deletes a say hello message whose date a reply moved on only when the new date passes', async () => {
    await addHello(NOW - DAY)
    await env.DB.prepare('UPDATE hello_messages SET replied_at = ?, delete_after = ?')
      .bind(NOW - 2 * DAY, NOW + 365 * DAY)
      .run()
    expect((await deleteExpiredRows(env.DB, NOW)).hello_messages).toBe(0)
    expect((await deleteExpiredRows(env.DB, NOW + 365 * DAY)).hello_messages).toBe(1)
  })

  it('deletes an application whose date the told outcome moved on only when the new date passes', async () => {
    await addApplication(NOW - DAY)
    // Recording the outcome replaces the backstop with a later date.
    await env.DB.prepare('UPDATE applications SET outcome_told_at = ?, delete_after = ?')
      .bind(NOW - 10 * DAY, NOW + DAY)
      .run()
    await deleteExpiredRows(env.DB, NOW)
    expect(await remaining('applications')).toEqual([NOW + DAY])
    await deleteExpiredRows(env.DB, NOW + DAY)
    expect(await remaining('applications')).toEqual([])
  })

  it('does nothing on an empty database', async () => {
    expect(await deleteExpiredRows(env.DB, NOW)).toEqual({
      hello_messages: 0,
      applications: 0,
      email_log: 0,
    })
  })
})

/**
 * Reads wrangler.jsonc as JSON: drops comments and trailing commas outside
 * strings, then parses it. Enough for our own config file.
 */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (inString) {
      out += char
      if (char === '\\') out += text[++i] ?? ''
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
      out += char
    } else if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (char === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
    } else {
      out += char
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

interface WranglerLevel {
  triggers?: { crons?: string[] }
  previews?: WranglerLevel
}

describe('deletion schedule', () => {
  const cron = /'([^']+)': \['retention:delete-expired'\]/.exec(nuxtConfig)?.[1]
  const config = parseJsonc(wranglerConfig) as WranglerLevel & {
    env: Record<string, WranglerLevel>
  }

  it('runs daily at 03:17 UTC, as set in nuxt.config.ts', () => {
    expect(cron).toBe('17 3 * * *')
  })

  it('has the same cron at the top level (local) and in staging and live, by name', () => {
    expect(config.triggers?.crons).toEqual([cron])
    expect(config.env.staging?.triggers?.crons).toEqual([cron])
    expect(config.env.live?.triggers?.crons).toEqual([cron])
  })

  it('has no cron in Previews or any other environment', () => {
    expect(config.env.staging?.previews?.triggers).toBeUndefined()
    expect(Object.keys(config.env).sort()).toEqual(['live', 'staging'])
  })
})
