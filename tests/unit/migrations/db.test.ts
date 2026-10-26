import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import roleSlugsMigration from '../../../migrations/db/0002_applications_role_slugs.sql?raw'
import { roles } from '../../../shared/forms/roles'

// Made-up test data only.
const RECEIVED = 1_793_000_000
const LATER = RECEIVED + 365 * 24 * 60 * 60
const FAKE_HMAC = 'a'.repeat(64)

const hello = {
  id: '00000000-0000-4000-8000-000000000001',
  submission_id: '00000000-0000-4000-8000-0000000000a1',
  call_name: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test message.',
  received_at: RECEIVED,
  delete_after: LATER,
}

const application = {
  id: '00000000-0000-4000-8000-000000000002',
  submission_id: '00000000-0000-4000-8000-0000000000a2',
  role: 'trustee',
  connection_to_founders: 'not_sure',
  call_name: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: JSON.stringify({ why_trustee: 'Made-up answer.', experience: 'Made-up answer.' }),
  received_at: RECEIVED,
  delete_after: LATER,
}

const emailLog = {
  id: '00000000-0000-4000-8000-000000000003',
  to_hmac: FAKE_HMAC,
  template_id: 'application_receipt',
  sent_at: RECEIVED,
  delete_after: LATER,
}

function insert(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row)
  const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  return env.DB.prepare(sql)
    .bind(...Object.values(row))
    .run()
}

async function columnsOf(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT name FROM pragma_table_info(?)`)
    .bind(table)
    .all<{ name: string }>()
  return results.map((row) => row.name).sort()
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM email_log'),
  ])
})

describe('D1 schema (migrations/db)', () => {
  it('has exactly the columns P3 allows, and nothing about the connection', async () => {
    expect(await columnsOf('hello_messages')).toEqual(
      [
        'call_name',
        'delete_after',
        'email',
        'id',
        'message',
        'received_at',
        'replied_at',
        'submission_id',
      ].sort(),
    )
    expect(await columnsOf('applications')).toEqual(
      [
        'answers',
        'call_name',
        'connection_to_founders',
        'delete_after',
        'email',
        'id',
        'outcome_told_at',
        'received_at',
        'role',
        'submission_id',
      ].sort(),
    )
    expect(await columnsOf('email_log')).toEqual(
      ['delete_after', 'id', 'sent_at', 'template_id', 'to_hmac'].sort(),
    )

    for (const table of ['hello_messages', 'applications', 'email_log']) {
      const columns = (await columnsOf(table)).join(' ')
      expect(columns).not.toMatch(/ip|user_agent|turnstile|token/)
    }
  })

  it('stores valid rows', async () => {
    await insert('hello_messages', hello)
    await insert('applications', application)
    await insert('email_log', emailLog)
    const counts = await env.DB.batch([
      env.DB.prepare('SELECT count(*) AS n FROM hello_messages'),
      env.DB.prepare('SELECT count(*) AS n FROM applications'),
      env.DB.prepare('SELECT count(*) AS n FROM email_log'),
    ])
    expect(counts.map((result) => (result.results[0] as { n: number }).n)).toEqual([1, 1, 1])
  })

  it('refuses a second row with the same submission id', async () => {
    await insert('hello_messages', hello)
    await expect(
      insert('hello_messages', { ...hello, id: '00000000-0000-4000-8000-000000000009' }),
    ).rejects.toThrow(/UNIQUE/)
    await insert('applications', application)
    await expect(
      insert('applications', { ...application, id: '00000000-0000-4000-8000-000000000009' }),
    ).rejects.toThrow(/UNIQUE/)
  })

  it('requires a deletion date after receipt on every row', async () => {
    const { delete_after: _hello, ...helloWithout } = hello
    await expect(insert('hello_messages', helloWithout)).rejects.toThrow(/NOT NULL/)
    await expect(insert('hello_messages', { ...hello, delete_after: RECEIVED })).rejects.toThrow(
      /CHECK/,
    )
    const { delete_after: _application, ...applicationWithout } = application
    await expect(insert('applications', applicationWithout)).rejects.toThrow(/NOT NULL/)
    const { delete_after: _log, ...logWithout } = emailLog
    await expect(insert('email_log', logWithout)).rejects.toThrow(/NOT NULL/)
  })

  it('never stores the refused founder-connection answers', async () => {
    for (const value of ['related_or_household', 'yes', '']) {
      await expect(
        insert('applications', { ...application, connection_to_founders: value }),
      ).rejects.toThrow(/CHECK/)
    }
    for (const value of ['friend_or_acquaintance', 'no', 'not_sure']) {
      await insert('applications', {
        ...application,
        id: crypto.randomUUID(),
        submission_id: crypto.randomUUID(),
        connection_to_founders: value,
      })
    }
  })

  it('requires answers to be a JSON object', async () => {
    for (const answers of ['not json', '[]', '"text"']) {
      await expect(insert('applications', { ...application, answers })).rejects.toThrow(/CHECK/)
    }
  })

  it('enforces the length limits from the contract', async () => {
    await expect(insert('hello_messages', { ...hello, call_name: '' })).rejects.toThrow(/CHECK/)
    await expect(insert('hello_messages', { ...hello, call_name: 'x'.repeat(61) })).rejects.toThrow(
      /CHECK/,
    )
    await expect(insert('hello_messages', { ...hello, message: 'x'.repeat(2001) })).rejects.toThrow(
      /CHECK/,
    )
    await expect(
      insert('hello_messages', { ...hello, email: `${'x'.repeat(243)}@example.com` }),
    ).rejects.toThrow(/CHECK/)
  })

  it('counts lengths in code points, like the browser and server checks', async () => {
    // 60 emoji are 60 code points but 120 UTF-16 code units.
    await insert('hello_messages', { ...hello, call_name: '🦊'.repeat(60) })
  })

  it('only accepts an HMAC in the email log, never an address', async () => {
    await expect(
      insert('email_log', { ...emailLog, to_hmac: 'test.fox@example.com' }),
    ).rejects.toThrow(/CHECK/)
    await expect(insert('email_log', { ...emailLog, to_hmac: 'A'.repeat(64) })).rejects.toThrow(
      /CHECK/,
    )
  })

  it('keeps strict column types', async () => {
    await expect(insert('hello_messages', { ...hello, received_at: 'yesterday' })).rejects.toThrow()
  })

  it('indexes delete_after for the deletion job', async () => {
    for (const table of ['hello_messages', 'applications', 'email_log']) {
      const plan = await env.DB.prepare(
        `EXPLAIN QUERY PLAN DELETE FROM ${table} WHERE delete_after <= ?`,
      )
        .bind(LATER)
        .all<{ detail: string }>()
      expect(plan.results.map((row) => row.detail).join(' ')).toContain(`${table}_delete_after`)
    }
  })
})

describe('email log', () => {
  it('indexes the per-address receipt limit lookup', async () => {
    const plan = await env.DB.prepare(
      'EXPLAIN QUERY PLAN SELECT count(*) FROM email_log WHERE to_hmac = ? AND sent_at > ?',
    )
      .bind(FAKE_HMAC, RECEIVED)
      .all<{ detail: string }>()
    expect(plan.results.map((row) => row.detail).join(' ')).toContain('email_log_to_hmac_sent_at')
  })
})

describe('application roles (0002)', () => {
  it('stores an application for every role in the role config', async () => {
    for (const [index, role] of roles.entries()) {
      const n = String(index).padStart(2, '0')
      await insert('applications', {
        ...application,
        id: `00000000-0000-4000-8000-0000000001${n}`,
        submission_id: `00000000-0000-4000-8000-0000000002${n}`,
        role: role.slug,
      })
    }
    const { results } = await env.DB.prepare('SELECT role FROM applications ORDER BY role').all<{
      role: string
    }>()
    expect(results.map((row) => row.role)).toEqual(roles.map((role) => role.slug).sort())
  })

  it('still refuses slugs that are not lowercase', async () => {
    for (const role of ['Trustee', 'safeguarding lead', '-trustee', 'trustee!', '']) {
      await expect(insert('applications', { ...application, role }), role).rejects.toThrow()
    }
  })

  it('keeps every row and constraint when the table is rebuilt', async () => {
    await insert('applications', { ...application, outcome_told_at: RECEIVED + 10 })
    const before = await env.DB.prepare('SELECT * FROM applications').all()
    // Run the rebuild again on a table that holds a row.
    const statements = roleSlugsMigration
      .replace(/^--.*$/gm, '')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)
    await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)))
    expect((await env.DB.prepare('SELECT * FROM applications').all()).results).toEqual(
      before.results,
    )
    await expect(
      insert('applications', { ...application, id: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toThrow(/UNIQUE/)
    await expect(
      insert('applications', {
        ...application,
        id: '00000000-0000-4000-8000-0000000000fe',
        submission_id: '00000000-0000-4000-8000-0000000000fd',
        connection_to_founders: 'related_or_household',
      }),
    ).rejects.toThrow()
  })
})
